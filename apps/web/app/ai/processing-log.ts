import type { ProviderPlace, Sensitivity } from "../library/sensitivity";
import { isSensitivity } from "../library/sensitivity";
import type { OpenTranslator } from "../library/translation-engine";

/**
 * Registro de la IA (04.6, «retención y fallback auditables»): qué libro pasó por qué proveedor,
 * para qué flujo, cuándo y si salió del equipo. Responde a «¿qué le mandé a OpenAI este mes?» y
 * a «¿algo confidencial salió de aquí?».
 *
 * Nunca guarda textos ni claves: solo el id del libro (el título se busca al enseñarlo, en la
 * biblioteca de este equipo), el proveedor, el modelo y cuánto se envió. Vive en este equipo y
 * no se sincroniza, como la sensibilidad. Se guarda 90 días y como mucho 1.000 entradas.
 *
 * No hay fallback automático entre proveedores: si uno falla o el router de sensibilidad no lo
 * deja (04.3), se para y queda apuntado con su razón. Nunca se cambia de proveedor ni se cruza
 * del equipo a la nube sin que la persona lo pida.
 */

export const processingFlows = ["catalog", "translate", "index", "ask", "summarize"] as const;
export type ProcessingFlow = (typeof processingFlows)[number];

export const processingFlowNames: Record<ProcessingFlow, string> = {
  ask: "Consultar",
  catalog: "Catalogar",
  index: "Indexar",
  summarize: "Resumir",
  translate: "Traducir",
};

/**
 * Qué decidió el router de sensibilidad antes de enviar:
 * - `allowed`: público o interno, o un motor del equipo; se envió.
 * - `consented`: personal, con el permiso de la persona; se envió.
 * - `kept-local`: confidencial con un proveedor en la nube; no salió nada.
 * - `needs-consent`: personal sin permiso; no salió nada.
 */
export const processingRoutes = ["allowed", "consented", "kept-local", "needs-consent"] as const;
export type ProcessingRoute = (typeof processingRoutes)[number];

/** Lo que decidió `routeFor` (04.3), dicho para el registro. */
export function auditRoute(route: "allow" | "ask" | "block", sensitivity: Sensitivity, place: ProviderPlace): ProcessingRoute {
  if (route === "block") return "kept-local";
  if (route === "ask") return "needs-consent";
  return place === "cloud" && sensitivity === "personal" ? "consented" : "allowed";
}

export function routeSent(route: ProcessingRoute) {
  return route === "allowed" || route === "consented";
}

export interface ProcessingEvent {
  /** Caracteres del libro que se mandaron (no el texto). */
  characters?: number;
  documentId: string;
  /** El motor de traducción (`ai:openai:gpt-…`, `browser`): con él se borra lo que devolvió. */
  engine?: string;
  /** Peticiones que fallaron tras los reintentos. */
  failed?: number;
  flow: ProcessingFlow;
  model: string | null;
  place: ProviderPlace;
  provider: string;
  route: ProcessingRoute;
  /** Peticiones que el proveedor respondió bien. */
  sent?: number;
  sensitivity: Sensitivity;
  /** Tokens de entrada y salida, si el proveedor los dice. */
  tokens?: number;
}

export interface ProcessingEntry {
  characters: number;
  /** Día local (AAAA-MM-DD). Lo de un libro con un proveedor y un flujo se junta por día. */
  day: string;
  documentId: string;
  engine: string | null;
  failed: number;
  firstAt: string;
  flow: ProcessingFlow;
  key: string;
  lastAt: string;
  model: string | null;
  place: ProviderPlace;
  provider: string;
  route: ProcessingRoute;
  sent: number;
  sensitivity: Sensitivity;
  tokens: number;
}

export const processingRetentionDays = 90;
export const processingMaxEntries = 1000;

const pad = (value: number) => String(value).padStart(2, "0");

/** El día local de una fecha, AAAA-MM-DD. */
export function dayKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function processingKey(day: string, event: Pick<ProcessingEvent, "documentId" | "flow" | "model" | "provider" | "route">) {
  return [day, event.flow, event.documentId, event.provider, event.model ?? "-", event.route].join("|");
}

const whole = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0);

/**
 * Apunta un envío: si ese día ya hay una entrada del mismo libro, flujo, proveedor, modelo y
 * decisión, se suma a ella; si no, entra una nueva. Devuelve la lista nueva, de la más reciente
 * a la más antigua.
 */
export function addProcessing(entries: readonly ProcessingEntry[], event: ProcessingEvent, now: Date): ProcessingEntry[] {
  const day = dayKey(now);
  const key = processingKey(day, event);
  const at = now.toISOString();
  const previous = entries.find((entry) => entry.key === key);
  const next: ProcessingEntry = {
    characters: (previous?.characters ?? 0) + whole(event.characters),
    day,
    documentId: event.documentId,
    engine: event.engine ?? previous?.engine ?? null,
    failed: (previous?.failed ?? 0) + whole(event.failed),
    firstAt: previous?.firstAt ?? at,
    flow: event.flow,
    key,
    lastAt: at,
    model: event.model,
    place: event.place,
    provider: event.provider,
    route: event.route,
    sent: (previous?.sent ?? 0) + whole(event.sent),
    // La más reciente: si la persona la cambió a media tarde, vale la del último envío.
    sensitivity: event.sensitivity,
    tokens: (previous?.tokens ?? 0) + whole(event.tokens),
  };
  return [next, ...entries.filter((entry) => entry.key !== key)];
}

/** Quita lo que pasó de los 90 días y lo que sobra de las 1.000 entradas (lo más antiguo). */
export function pruneProcessing(
  entries: readonly ProcessingEntry[],
  now: Date,
  { maxEntries = processingMaxEntries, retentionDays = processingRetentionDays } = {},
) {
  const limit = new Date(now);
  limit.setDate(limit.getDate() - retentionDays);
  const oldest = dayKey(limit);
  return [...entries]
    .filter((entry) => entry.day >= oldest)
    .sort((left, right) => right.lastAt.localeCompare(left.lastAt))
    .slice(0, maxEntries);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const text = (value: unknown) => (typeof value === "string" && value ? value : null);

/** Lee lo guardado sin fiarse: lo que no encaja se descarta. */
export function parseProcessingLog(value: unknown): ProcessingEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: ProcessingEntry[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const day = text(raw.day);
    const documentId = text(raw.documentId);
    const provider = text(raw.provider);
    const firstAt = text(raw.firstAt);
    const lastAt = text(raw.lastAt);
    const flow = raw.flow;
    const route = raw.route;
    if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !documentId || !provider || !firstAt || !lastAt) continue;
    if (!(processingFlows as readonly unknown[]).includes(flow)) continue;
    if (!(processingRoutes as readonly unknown[]).includes(route)) continue;
    const event = {
      documentId,
      flow: flow as ProcessingFlow,
      model: text(raw.model),
      provider,
      route: route as ProcessingRoute,
    };
    entries.push({
      ...event,
      characters: whole(raw.characters),
      day,
      engine: text(raw.engine),
      failed: whole(raw.failed),
      firstAt,
      key: processingKey(day, event),
      lastAt,
      place: raw.place === "device" ? "device" : "cloud",
      sent: whole(raw.sent),
      sensitivity: isSensitivity(raw.sensitivity) ? raw.sensitivity : "interno",
      tokens: whole(raw.tokens),
    });
  }
  return entries;
}

/* ---- Para enseñarlo ---------------------------------------------------------------------------- */

export const processingRouteNames: Record<ProcessingRoute, string> = {
  allowed: "Enviado",
  consented: "Enviado con tu permiso (personal)",
  "kept-local": "No salió del equipo: es confidencial",
  "needs-consent": "No salió del equipo: personal, sin tu permiso",
};

export type ProcessingFilter = "all" | "cloud" | "device" | "kept";

export function matchesFilter(entry: ProcessingEntry, filter: ProcessingFilter) {
  if (filter === "all") return true;
  if (filter === "kept") return !routeSent(entry.route);
  return routeSent(entry.route) && entry.place === filter;
}

export interface ProcessingSummary {
  /** Libros distintos cuyo texto salió del equipo. */
  cloudBooks: number;
  /** Proveedores en la nube que recibieron algo. */
  cloudProviders: string[];
  /** Libros distintos procesados en este equipo (Ollama local, el traductor del navegador). */
  deviceBooks: number;
  /** Libros distintos que el router no dejó salir. */
  keptBooks: number;
}

export function summarizeProcessing(entries: readonly ProcessingEntry[]): ProcessingSummary {
  const cloud = new Set<string>();
  const device = new Set<string>();
  const kept = new Set<string>();
  const providers = new Set<string>();
  for (const entry of entries) {
    if (!routeSent(entry.route)) kept.add(entry.documentId);
    else if (entry.place === "cloud") {
      cloud.add(entry.documentId);
      providers.add(entry.provider);
    } else device.add(entry.documentId);
  }
  return { cloudBooks: cloud.size, cloudProviders: [...providers].sort(), deviceBooks: device.size, keptBooks: kept.size };
}

/**
 * El registro para descargarlo: sin textos, con el título que tiene hoy cada libro en este equipo
 * (o null si ya no está).
 */
export function processingExport(entries: readonly ProcessingEntry[], titleOf: (documentId: string) => string | null, now: Date) {
  return {
    // Sin `key`: es interna, para juntar lo del mismo día.
    entries: entries.map((entry) => {
      const { key, ...rest } = entry;
      void key;
      return { ...rest, title: titleOf(entry.documentId) };
    }),
    exportedAt: now.toISOString(),
    note: "Registro de la IA de Pliegue: qué libro pasó por qué proveedor. No contiene textos ni claves.",
    retentionDays: processingRetentionDays,
    version: 1,
  };
}

/** `ai:ollama:qwen3:8b:en>es` es del motor `ai:ollama:qwen3:8b`; `ai:ollama:qwen3` no lo es. */
export function pairBelongsToEngine(pairId: string, engine: string) {
  if (!pairId.startsWith(`${engine}:`)) return false;
  return /^[^:>]+>[^:>]+$/.test(pairId.slice(engine.length + 1));
}

/* ---- Traducir: el motor y lo que se mandó ------------------------------------------------------ */

/** `ai:ollama:qwen3:8b` → Ollama con `qwen3:8b`; `browser` → el traductor del navegador. */
export function engineIdentity(engine: string): { model: string | null; provider: string } {
  if (!engine.startsWith("ai:")) return { model: null, provider: engine };
  const [, provider = "ai", ...model] = engine.split(":");
  return { model: model.length ? model.join(":") : null, provider };
}

function isAbort(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

/**
 * Envuelve el traductor de una sesión para contar lo que se le manda, sin guardar el texto. Lo
 * contado se recoge con `flush()` al guardar cada página o sección: una escritura por página y no
 * una por frase (el traductor del navegador traduce frase a frase). Un fallo se avisa al momento;
 * lo que se cancela («Detener», cerrar el libro), no.
 */
export function auditTranslator(translator: OpenTranslator, onFailure: (characters: number) => void) {
  let pending = 0;
  async function track<T>(characters: number, run: () => Promise<T>) {
    try {
      const result = await run();
      pending += characters;
      return result;
    } catch (error) {
      if (!isAbort(error)) onFailure(characters);
      throw error;
    }
  }
  const { translateMany } = translator;
  const audited: OpenTranslator = {
    ...translator,
    translate: (text, signal) => track(text.length, () => translator.translate(text, signal)),
    ...(translateMany
      ? {
          translateMany: (texts: readonly string[], signal?: AbortSignal, glossary?: Parameters<NonNullable<OpenTranslator["translateMany"]>>[2]) =>
            track(
              texts.reduce((sum, text) => sum + text.length, 0),
              () => translateMany.call(translator, texts, signal, glossary),
            ),
        }
      : {}),
  };
  return {
    flush() {
      const characters = pending;
      pending = 0;
      return characters;
    },
    translator: audited,
  };
}

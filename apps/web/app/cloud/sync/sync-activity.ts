import type { LibraryDocument } from "../../library/documents";
import type { SyncSummary } from "./sync-runner";

/** Los archivos de este equipo por origen y los libros distintos que suman. */
export interface SyncBooks {
  /** Archivos de cada origen, contando cada copia de un libro en el suyo. */
  byOrigin: Record<LibraryDocument["reference"]["kind"], number>;
  /** Libros distintos: las copias del mismo archivo (mismo nombre y tamaño) cuentan una vez. */
  distinct: number;
  /** Libros con copia en local y en Google Drive a la vez: comparten avance y notas. */
  inBoth: number;
}

/**
 * Cuenta los libros por origen. La biblioteca muestra una sola vez el libro que está en local y
 * en Drive —la copia que guarda su estado, con la lista de las demás—: si solo se contara esa,
 * Google Drive se quedaría en 0 en cuanto se agrupan las copias.
 */
export function countBooks(documents: readonly LibraryDocument[], distinct: number): SyncBooks {
  const byOrigin: SyncBooks["byOrigin"] = { "google-drive": 0, "local-copy": 0, "local-file": 0, "local-folder": 0 };
  let inBoth = 0;
  for (const document of documents) {
    const kinds = document.copies?.length ? document.copies.map((copy) => copy.kind) : [document.reference.kind];
    for (const kind of kinds) byOrigin[kind] += 1;
    if (kinds.includes("google-drive") && kinds.some((kind) => kind !== "google-drive")) inBoth += 1;
  }
  return { byOrigin, distinct, inBoth };
}

/**
 * Lo que la persona ve de cada vuelta en Ajustes → Cuenta. Una vuelta cada 45 s sin cambios
 * no debe llenar la lista: las comprobaciones seguidas sin cambios se juntan en una línea.
 */
export interface SyncActivity {
  /** Fin de la vuelta (o de la última comprobación agrupada), en ISO. */
  at: string;
  /** Recibido de otros equipos, por colección. */
  applied: Record<string, number>;
  /** Comprobaciones sin cambios agrupadas en esta línea. */
  checks?: number;
  kind: "changes" | "checked" | "error";
  message?: string;
  /** Subido desde este equipo, por colección. */
  pushed: Record<string, number>;
  /** Primera comprobación del grupo, en ISO. */
  since?: string;
}

export const activityLimit = 8;

/** Nombre de cada colección, en singular y en plural, para contar lo que viajó. */
export const collectionNames: Record<string, { one: string; many: string; label: string }> = {
  annotations: { label: "Notas y resaltados", many: "notas", one: "nota" },
  "book-translation": { label: "Idiomas de traducción", many: "idiomas de traducción", one: "idioma de traducción" },
  "catalog-ai": { label: "Fichas de la IA", many: "fichas de la IA", one: "ficha de la IA" },
  "catalog-import": { label: "Fichas del índice JSON", many: "fichas del índice", one: "ficha del índice" },
  favorites: { label: "Favoritos", many: "favoritos", one: "favorito" },
  "reading-progress": { label: "Avance de lectura", many: "avances", one: "avance" },
  settings: { label: "Ajustes", many: "ajustes", one: "ajuste" },
};

/** Una vuelta terminada, lista para el registro. */
export function activityFromSummary(summary: SyncSummary, at: string): SyncActivity {
  const applied: Record<string, number> = {};
  const pushed: Record<string, number> = {};
  for (const [name, counts] of Object.entries(summary.collections)) {
    if (counts.applied) applied[name] = counts.applied;
    if (counts.pushed) pushed[name] = counts.pushed;
  }
  const changed = Object.keys(applied).length > 0 || Object.keys(pushed).length > 0;
  return { applied, at, kind: changed ? "changes" : "checked", pushed };
}

/** Añade una vuelta al registro, la más reciente primero. */
export function recordActivity(log: readonly SyncActivity[], entry: SyncActivity, limit = activityLimit): SyncActivity[] {
  const [latest, ...rest] = log;
  if (entry.kind === "checked" && latest?.kind === "checked") {
    return [{ ...entry, checks: (latest.checks ?? 1) + 1, since: latest.since ?? latest.at }, ...rest].slice(0, limit);
  }
  return [entry, ...log].slice(0, limit);
}

function total(counts: Record<string, number>) {
  return Object.values(counts).reduce((sum, value) => sum + value, 0);
}

function detail(counts: Record<string, number>) {
  return Object.entries(counts)
    .map(([name, count]) => {
      const names = collectionNames[name] ?? { many: name, one: name };
      return `${count} ${count === 1 ? names.one : names.many}`;
    })
    .join(", ");
}

/** «subidos 2: 1 avance, 1 nota · recibida 1 nota». */
export function describeChanges(entry: Pick<SyncActivity, "applied" | "pushed">) {
  const parts: string[] = [];
  const up = total(entry.pushed);
  const down = total(entry.applied);
  if (up) parts.push(`${up === 1 ? "subido 1" : `subidos ${up}`}: ${detail(entry.pushed)}`);
  if (down) parts.push(`${down === 1 ? "recibido 1" : `recibidos ${down}`}: ${detail(entry.applied)}`);
  return parts.join(" · ");
}

export function describeActivity(entry: SyncActivity) {
  if (entry.kind === "error") return entry.message ?? "No fue posible sincronizar.";
  if (entry.kind === "checked") return entry.checks && entry.checks > 1 ? `comprobado ${entry.checks} veces, sin cambios` : "comprobado, sin cambios";
  return describeChanges(entry);
}

/**
 * Cuánto de lo de este equipo está ya en la nube. Tras una vuelta buena, todo; si la última
 * falló, lo que quedó sin subir no cuenta. Sin nada que sincronizar, también todo.
 */
export function syncedPercent(summary: SyncSummary | null, unsynced: number) {
  if (!summary) return null;
  const local = Object.values(summary.collections)
    .filter((counts) => !counts.disabled)
    .reduce((sum, counts) => sum + counts.local, 0);
  if (local === 0) return 100;
  return Math.max(0, Math.min(100, Math.floor(((local - Math.min(unsynced, local)) / local) * 100)));
}

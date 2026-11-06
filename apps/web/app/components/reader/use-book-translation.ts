"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { defaultPagesAhead, translationPairId, type TranslationPair } from "../../library/translation";
import type { TranslationEngine } from "../../library/translation-engine";
import {
  TranslationSession,
  type SourceUnit,
  type TranslationSnapshot,
} from "../../library/translation-session";
import { assertWithinBudget } from "../../ai/ai-usage-store";
import { routeFor, type ProviderPlace, type Sensitivity } from "../../library/sensitivity";
import { hasConsent } from "../../library/sensitivity-store";
import { confirmPersonalSend } from "../ai/sensitive-consent";
import { useBookGlossary } from "../../library/translation-glossary-store";
import {
  clearTranslation,
  listTranslatedUnits,
  readTranslatedUnit,
  translatedUnitKey,
  trimTranslations,
  writeTranslatedUnit,
} from "../../library/translation-store";

/**
 * Traducción de un libro abierto en el lector: abre el motor —con la descarga del paquete de
 * idioma, si hace falta—, crea la sesión y la mantiene al día con la página que se lee.
 *
 * Hay dos motores: el traductor del navegador, gratis y en el dispositivo, y «Tu IA», el
 * proveedor y la clave que la persona puso en Ajustes. Cada libro recuerda con cuál se tradujo.
 */

export type TranslationEngineKind = "browser" | "ai";

export type TranslationPhase =
  | { kind: "off" }
  | { kind: "checking" }
  | { fraction: number; kind: "downloading" }
  | { kind: "ready" }
  | { kind: "unsupported" }
  | { kind: "unavailable" }
  /** «Tu IA» sin la clave del proveedor en esta sesión. */
  | { kind: "needs-key" }
  /** «Tu IA» sin proveedor elegido en Ajustes. */
  | { kind: "needs-provider" }
  /** Libro confidencial y «Tu IA» fuera del equipo: solo se traduce en el equipo (04.3). */
  | { kind: "sensitive" }
  | { kind: "error"; message: string };

const idleSnapshot: TranslationSnapshot = {
  budget: false,
  done: 0,
  error: null,
  failed: new Set(),
  pending: [],
  percent: 0,
  version: 0,
  whole: false,
  working: null,
};

function subscribeToNothing() {
  return () => {};
}

function idle() {
  return idleSnapshot;
}

// ---- Qué par de idiomas se eligió para cada libro --------------------------------------

const preferenceKey = "pliegue-book-translation";

interface SavedTranslation extends TranslationPair {
  /** Sin él, de antes de que hubiera dos motores: el del navegador. */
  engine?: TranslationEngineKind;
}

function readPreference(documentId: string): SavedTranslation | null {
  try {
    const saved = JSON.parse(window.localStorage.getItem(preferenceKey) ?? "{}") as Record<string, SavedTranslation>;
    const pair = saved[documentId];
    return pair && typeof pair.source === "string" && typeof pair.target === "string" ? pair : null;
  } catch {
    return null;
  }
}

function writePreference(documentId: string, pair: SavedTranslation | null) {
  try {
    const saved = JSON.parse(window.localStorage.getItem(preferenceKey) ?? "{}") as Record<string, SavedTranslation>;
    if (pair) saved[documentId] = pair;
    else delete saved[documentId];
    window.localStorage.setItem(preferenceKey, JSON.stringify(saved));
  } catch {
    // Sin almacenamiento: la traducción funciona igual, solo que no se recuerda.
  }
}

function describeEngineError(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError") {
    return "El navegador pide un clic para descargar el idioma: pulsa «Traducir este libro».";
  }
  if (name === "QuotaExceededError") return "No hay espacio para descargar el paquete de idioma.";
  if (name === "NetworkError") return "No se pudo descargar el paquete de idioma. Comprueba la conexión.";
  // El traductor de Chrome a veces no llega a crearse —«Unable to create translator for the
  // given source and target language»— aunque el par exista: se dice en español y con salida.
  if (name === "NotSupportedError" || name === "OperationError" || name === "InvalidStateError" || name === "UnknownError") {
    return "El traductor del navegador no pudo prepararse para estos idiomas. Vuelve a intentarlo o traduce con «Tu IA».";
  }
  // Los fallos de «Tu IA» ya vienen redactados por la ruta; los del navegador, en inglés.
  const message = error instanceof Error ? error.message : "";
  return message && !/^[\x20-\x7e]+$/.test(message) ? message : "No se pudo abrir el traductor. Vuelve a intentarlo o traduce con «Tu IA».";
}

export interface BookTranslationOptions<Block extends { text: string }> {
  /** Dónde trabaja «Tu IA»: en este equipo (Ollama local) o fuera (04.3). */
  aiPlace?: ProviderPlace;
  /** El proveedor de «Tu IA», para decir a quién iría el texto. */
  aiProviderName?: string;
  currentUnit: number;
  /** Motor con el que se empieza si el libro no recuerda otro. */
  defaultEngine: TranslationEngineKind;
  documentId: string;
  engines: Readonly<Record<TranslationEngineKind, TranslationEngine>>;
  loadUnit: (unit: number) => Promise<SourceUnit<Block>>;
  pagesAhead?: number;
  /** Sensibilidad del libro (04.3): sin ella, «interno». */
  sensitivity?: Sensitivity;
  /** El título, para preguntar por un libro personal. */
  title?: string;
  /** 0 mientras no se sabe cuántas páginas tiene: no se empieza hasta saberlo. */
  unitCount: number;
  unitId: (unit: number) => string;
}

export function useBookTranslation<Block extends { text: string }>({
  aiPlace = "cloud",
  aiProviderName = "tu IA",
  currentUnit,
  defaultEngine,
  documentId,
  engines,
  loadUnit,
  pagesAhead = defaultPagesAhead,
  sensitivity = "interno",
  title = "Este libro",
  unitCount,
  unitId,
}: BookTranslationOptions<Block>) {
  const [phase, setPhase] = useState<TranslationPhase>({ kind: "off" });
  const [pair, setPair] = useState<TranslationPair | null>(null);
  // El motor elegido; mientras no se elige ninguno, el predeterminado de ahora. Derivado y no
  // copiado al estado: en el servidor no se sabe si el navegador trae traductor, y el primer
  // valor dejaba fijado el del navegador también en Firefox.
  const [chosenEngine, setEngineKind] = useState<TranslationEngineKind | null>(null);
  const engineKind = chosenEngine ?? defaultEngine;
  const engine = engines[engineKind];
  const [session, setSession] = useState<TranslationSession<Block> | null>(null);
  const snapshot = useSyncExternalStore(
    session?.subscribe ?? subscribeToNothing,
    session?.getSnapshot ?? idle,
    idle,
  );
  // La sesión lee con la versión vigente de `loadUnit` aunque el lector se vuelva a pintar.
  const loadRef = useRef(loadUnit);
  const idRef = useRef(unitId);
  const attemptRef = useRef(0);
  // El glosario del libro hacia el idioma que se traduce (05.5): la sesión lo lee al traducir
  // cada página, y si cambia, repasa lo traducido.
  const glossary = useBookGlossary(documentId, pair?.target ?? null);
  const glossaryRef = useRef(glossary.entries);
  const glossarySignature = glossary.entries.map((entry) => `${entry.source}=${entry.target}`).join("|");
  const signatureRef = useRef(glossarySignature);

  useEffect(() => {
    loadRef.current = loadUnit;
    idRef.current = unitId;
    glossaryRef.current = glossary.entries;
  });

  useEffect(() => {
    if (signatureRef.current === glossarySignature) return;
    signatureRef.current = glossarySignature;
    session?.refreshGlossary();
  }, [glossarySignature, session]);

  useEffect(() => {
    session?.setCurrent(currentUnit);
  }, [currentUnit, session]);

  useEffect(() => () => session?.dispose(), [session]);

  const start = useCallback(
    async (next: TranslationPair, kind: TranslationEngineKind = engineKind, interactive = true) => {
      if (unitCount <= 0) return;
      const attempt = (attemptRef.current += 1);
      const chosen = engines[kind];
      setSession(null);
      setPair(next);
      setEngineKind(kind);
      // Sensibilidad (04.3): confidencial, solo en el equipo; personal, con permiso una vez. Al
      // retomar un libro sin pulsar nada no se pregunta: espera al botón.
      const route = routeFor(sensitivity, kind === "browser" ? "device" : aiPlace, hasConsent(documentId, "translate"));
      if (route === "block") {
        setPhase({ kind: "sensitive" });
        return;
      }
      if (route === "ask") {
        const accepted = interactive && (await confirmPersonalSend([{ id: documentId, title }], "translate", aiProviderName));
        if (attempt !== attemptRef.current) return;
        if (!accepted) {
          setPhase({ kind: "off" });
          return;
        }
      }
      setPhase({ kind: "checking" });
      const availability = await chosen.availability(next);
      if (attempt !== attemptRef.current) return;
      if (
        availability === "unsupported" ||
        availability === "unavailable" ||
        availability === "needs-key" ||
        availability === "needs-provider"
      ) {
        setPhase({ kind: availability });
        return;
      }
      try {
        if (availability !== "available") setPhase({ fraction: 0, kind: "downloading" });
        const translator = await chosen.create(next, (fraction) => {
          if (attempt === attemptRef.current) setPhase({ fraction, kind: "downloading" });
        });
        const pairId = translationPairId(chosen.id, next);
        const storedIds = await listTranslatedUnits(documentId, pairId).catch(() => new Set<string>());
        if (attempt !== attemptRef.current) {
          translator.destroy();
          return;
        }
        // «Tu IA» cuenta para el presupuesto del mes (04.6); el traductor del navegador, no.
        const budgetProvider = chosen.id.startsWith("ai:") ? (chosen.id.split(":")[1] ?? null) : null;
        setSession(
          new TranslationSession<Block>({
            ...(budgetProvider ? { gate: () => assertWithinBudget(budgetProvider, documentId) } : {}),
            glossary: () => glossaryRef.current,
            loadUnit: (unit) => loadRef.current(unit),
            pagesAhead,
            storage: {
              read: async (id) => (await readTranslatedUnit(documentId, pairId, id))?.blocks ?? null,
              write: async (id, blocks) => {
                await writeTranslatedUnit({
                  blocks,
                  documentId,
                  key: translatedUnitKey(documentId, pairId, id),
                  pairId,
                  translatedAt: new Date().toISOString(),
                  unitId: id,
                });
                // Con el tope lleno se van las traducciones más antiguas de otros libros (05.6).
                // No frena la lectura: si falla, se queda como estaba.
                void trimTranslations(documentId).catch(() => undefined);
              },
            },
            storedIds,
            translator,
            unitCount,
            unitId: (unit) => idRef.current(unit),
          }),
        );
        setPhase({ kind: "ready" });
        writePreference(documentId, { ...next, engine: kind });
        // Un libro traducido son muchas páginas guardadas: se pide que el navegador no las
        // borre por falta de espacio o de uso (Safari lo hace a los siete días). Si dice que
        // no, todo sigue igual.
        void navigator.storage?.persist?.().catch(() => false);
      } catch (error) {
        if (attempt === attemptRef.current) setPhase({ kind: "error", message: describeEngineError(error) });
      }
    },
    [aiPlace, aiProviderName, documentId, engineKind, engines, pagesAhead, sensitivity, title, unitCount],
  );

  const stop = useCallback(() => {
    attemptRef.current += 1;
    setSession(null);
    setPhase({ kind: "off" });
    writePreference(documentId, null);
  }, [documentId]);

  /** Borra lo traducido de este libro a ese idioma y apaga la traducción. */
  const clear = useCallback(async () => {
    const current = pair;
    stop();
    setPair(null);
    if (current) await clearTranslation(documentId, translationPairId(engine.id, current));
  }, [documentId, engine.id, pair, stop]);

  // Al volver a abrir un libro que se estaba traduciendo, se retoma sin pedir otro clic si el
  // paquete del idioma ya está en el dispositivo; si hay que descargarlo, espera al botón.
  const resumeRef = useRef(false);
  useEffect(() => {
    if (resumeRef.current || unitCount <= 0) return;
    resumeRef.current = true;
    const saved = readPreference(documentId);
    if (!saved) return;
    const kind = saved.engine ?? "browser";
    const pairOnly = { source: saved.source, target: saved.target };
    let cancelled = false;
    void engines[kind].availability(pairOnly).then((availability) => {
      if (cancelled) return;
      if (availability === "available") void start(pairOnly, kind, false);
      else {
        setEngineKind(kind);
        setPair(pairOnly);
        // «Tu IA» tras recargar: la clave era de la sesión anterior. El panel lo dice.
        if (availability === "needs-key" || availability === "needs-provider") setPhase({ kind: availability });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [documentId, engines, start, unitCount]);

  const unit = useCallback((number: number) => session?.unit(number), [session]);
  const retry = useCallback(() => session?.retry(), [session]);
  const translateAll = useCallback(() => session?.translateAll(), [session]);
  const stopWhole = useCallback(() => session?.stopWhole(), [session]);
  const remaining = useCallback(() => session?.remaining() ?? { characters: 0, units: 0 }, [session]);

  /** Cambia de motor antes de empezar; con la traducción en marcha hay que detenerla antes. */
  const chooseEngine = useCallback((kind: TranslationEngineKind) => {
    setEngineKind(kind);
    setPhase((current) => (current.kind === "ready" ? current : { kind: "off" }));
  }, []);

  return { chooseEngine, clear, engine, engineKind, pair, phase, remaining, retry, snapshot, start, stop, stopWhole, translateAll, unit };
}

export type BookTranslation<Block extends { text: string }> = ReturnType<typeof useBookTranslation<Block>>;

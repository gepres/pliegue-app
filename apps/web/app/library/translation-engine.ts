"use client";

import { detectTextLanguage } from "./language";
import { chunkBySentence, hashText, isTranslatable, type TranslatedBlock, type TranslationPair } from "./translation";

/**
 * Motores de traducción. El primero, y el predeterminado, es el traductor que el propio
 * navegador trae integrado (Chrome de escritorio desde la versión 138): traduce en el
 * dispositivo, no cuesta nada, no pide cuenta ni clave y el texto del libro no sale del
 * equipo. Se detecta por la API y no por la marca del navegador: el día que otro la
 * implemente, funciona sin tocar nada.
 */

export type EngineAvailability =
  /** Listo para traducir ya. */
  | "available"
  /** Hace falta descargar el paquete del idioma; solo puede empezar tras un gesto de la persona. */
  | "downloadable"
  | "downloading"
  /** El navegador tiene el traductor, pero no este par de idiomas. */
  | "unavailable"
  /** Este navegador no trae traductor. */
  | "unsupported"
  /** El motor usa la clave del proveedor y en esta sesión aún no se ha puesto. */
  | "needs-key"
  /** «Tu IA» sin proveedor: en Ajustes sigue el traductor del navegador. */
  | "needs-provider";

export interface OpenTranslator {
  destroy: () => void;
  translate: (text: string, signal?: AbortSignal) => Promise<string>;
  /**
   * Traduce varios pasajes de una vez y devuelve uno por pasaje, en orden. Los motores remotos
   * lo ofrecen: una página entera es una sola petición en lugar de una por párrafo.
   */
  translateMany?: (texts: readonly string[], signal?: AbortSignal) => Promise<string[]>;
}

export interface TranslationEngine {
  availability: (pair: TranslationPair) => Promise<EngineAvailability>;
  /** Abre el traductor del par; si hay que descargar, llamarlo desde el gesto que lo pide. */
  create: (pair: TranslationPair, onDownload?: (fraction: number) => void, signal?: AbortSignal) => Promise<OpenTranslator>;
  id: string;
  label: string;
  /** Traduce sin que el texto salga del dispositivo. */
  onDevice: boolean;
}

/** Hay traductor integrado en este navegador (Chrome y Edge de escritorio, hoy). */
export function hasBuiltInTranslator() {
  return builtInTranslator() !== null;
}

// ---- Traductor integrado del navegador -------------------------------------------------

type BuiltInAvailability = "available" | "downloadable" | "downloading" | "unavailable";

interface BuiltInTranslator {
  destroy: () => void;
  translate: (input: string, options?: { signal?: AbortSignal }) => Promise<string>;
}

interface BuiltInTranslatorFactory {
  availability: (options: { sourceLanguage: string; targetLanguage: string }) => Promise<BuiltInAvailability>;
  create: (options: {
    monitor?: (monitor: EventTarget) => void;
    signal?: AbortSignal;
    sourceLanguage: string;
    targetLanguage: string;
  }) => Promise<BuiltInTranslator>;
}

interface BuiltInLanguageDetector {
  destroy?: () => void;
  detect: (input: string) => Promise<{ confidence: number; detectedLanguage: string }[]>;
}

interface BuiltInLanguageDetectorFactory {
  availability: () => Promise<BuiltInAvailability>;
  create: () => Promise<BuiltInLanguageDetector>;
}

function builtInTranslator() {
  const factory = (globalThis as { Translator?: BuiltInTranslatorFactory }).Translator;
  return factory && typeof factory.create === "function" ? factory : null;
}

function builtInDetector() {
  const factory = (globalThis as { LanguageDetector?: BuiltInLanguageDetectorFactory }).LanguageDetector;
  return factory && typeof factory.create === "function" ? factory : null;
}

export const browserEngine: TranslationEngine = {
  async availability(pair) {
    const factory = builtInTranslator();
    if (!factory) return "unsupported";
    try {
      return await factory.availability({ sourceLanguage: pair.source, targetLanguage: pair.target });
    } catch {
      return "unavailable";
    }
  },
  async create(pair, onDownload, signal) {
    const factory = builtInTranslator();
    if (!factory) throw new Error("Este navegador no trae un traductor integrado.");
    const translator = await factory.create({
      monitor(monitor) {
        monitor.addEventListener("downloadprogress", (event) => {
          const { loaded } = event as ProgressEvent;
          if (Number.isFinite(loaded)) onDownload?.(Math.min(1, Math.max(0, loaded)));
        });
      },
      ...(signal ? { signal } : {}),
      sourceLanguage: pair.source,
      targetLanguage: pair.target,
    });
    return {
      destroy: () => translator.destroy(),
      translate: (text, abort) => translator.translate(text, abort ? { signal: abort } : undefined),
    };
  },
  id: "browser",
  label: "Traductor integrado del navegador",
  onDevice: true,
};

/**
 * Idioma de un texto: el detector del navegador si ya está listo —sin descargas ni gestos—
 * y, si no, el recuento de palabras vacías que ya se usa al indexar.
 */
export async function detectLanguage(text: string) {
  const factory = builtInDetector();
  if (factory) {
    try {
      if ((await factory.availability()) === "available") {
        const detector = await factory.create();
        try {
          const [best] = await detector.detect(text.slice(0, 4000));
          if (best && best.confidence >= 0.7 && best.detectedLanguage !== "und") {
            return best.detectedLanguage.split("-")[0] ?? null;
          }
        } finally {
          detector.destroy?.();
        }
      }
    } catch {
      // Sin detector utilizable: vale el recuento local.
    }
  }
  return detectTextLanguage(text);
}

/** Máximo de caracteres que se mandan al motor de una vez: párrafos enteros casi siempre. */
const chunkLength = 1200;

/** En un lote, un pasaje puede ser más largo: el modelo ve el párrafo entero. */
const batchChunkLength = 4000;

/**
 * Traduce los bloques de una unidad en orden. Lo que no tiene palabras se copia, y un bloque
 * muy largo se traduce frase a frase y se vuelve a unir.
 */
export async function translateBlocks(translator: OpenTranslator, texts: readonly string[], signal?: AbortSignal) {
  if (translator.translateMany) return translateBlocksInBatch(translator.translateMany, texts, signal);
  const blocks: TranslatedBlock[] = [];
  for (const text of texts) {
    signal?.throwIfAborted();
    if (!isTranslatable(text)) {
      blocks.push({ hash: hashText(text), text });
      continue;
    }
    // Con saltos de renglón (un índice, un poema), cada renglón se traduce por su cuenta y los
    // saltos se conservan; si no, el bloque es un párrafo y se traduce seguido.
    const lines: string[] = [];
    for (const line of text.split("\n")) {
      if (!isTranslatable(line)) {
        lines.push(line);
        continue;
      }
      const parts: string[] = [];
      for (const chunk of chunkBySentence(line, chunkLength)) {
        parts.push(await translator.translate(chunk, signal));
      }
      lines.push(parts.join(" ").trim());
    }
    blocks.push({ hash: hashText(text), text: lines.join("\n") });
  }
  return blocks;
}

/**
 * Lo mismo con un motor que traduce por lotes: los bloques de la unidad van juntos, cada uno
 * entero —con sus saltos de renglón, que el modelo respeta— salvo que sea larguísimo, y
 * entonces se parte por frases y se vuelve a unir. Si el modelo deja un pasaje vacío, queda el
 * original: mejor leer el texto sin traducir que un hueco.
 */
async function translateBlocksInBatch(
  translateMany: NonNullable<OpenTranslator["translateMany"]>,
  texts: readonly string[],
  signal?: AbortSignal,
) {
  const pieces: { block: number; text: string }[] = [];
  texts.forEach((text, block) => {
    if (!isTranslatable(text)) return;
    for (const piece of chunkBySentence(text, batchChunkLength)) pieces.push({ block, text: piece });
  });

  signal?.throwIfAborted();
  const translated = pieces.length > 0 ? await translateMany(pieces.map((piece) => piece.text), signal) : [];
  const byBlock = new Map<number, string[]>();
  pieces.forEach((piece, index) => {
    const parts = byBlock.get(piece.block) ?? [];
    parts.push(translated[index]?.trim() || piece.text);
    byBlock.set(piece.block, parts);
  });

  return texts.map<TranslatedBlock>((text, index) => ({
    hash: hashText(text),
    text: byBlock.get(index)?.join(" ") ?? text,
  }));
}

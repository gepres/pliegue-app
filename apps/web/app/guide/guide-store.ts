"use client";

import { useSyncExternalStore } from "react";

/**
 * La guía de primeros pasos. Tras una acción importante —vincular una carpeta, añadir la clave
 * de la IA, catalogar— Pliegue sugiere el paso siguiente en un modal. Quien ya conoce el camino
 * puede apagarlo; la lista de Inicio sigue diciendo dónde está cada cosa.
 */
interface GuideState {
  /** «No volver a sugerir pasos». */
  muted: boolean;
}

const storageKey = "pliegue-guia-v1";
const defaultState: GuideState = { muted: false };
const listeners = new Set<() => void>();
let cachedSerialized: string | null | undefined;
let cachedState = defaultState;

function read(): GuideState {
  try {
    const serialized = window.localStorage.getItem(storageKey);
    if (serialized === cachedSerialized) return cachedState;
    cachedSerialized = serialized;
    cachedState = serialized ? { ...defaultState, ...(JSON.parse(serialized) as Partial<GuideState>) } : defaultState;
  } catch {
    cachedState = defaultState;
  }
  return cachedState;
}

export function guideMuted() {
  return typeof window !== "undefined" && read().muted;
}

export function setGuideMuted(muted: boolean) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify({ ...read(), muted }));
  } catch {
    // Sin almacenamiento, la elección dura lo que la pestaña.
  }
  cachedSerialized = undefined;
  for (const listener of listeners) listener();
}

export function useGuideMuted() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => read().muted,
    () => false,
  );
}

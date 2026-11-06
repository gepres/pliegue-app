"use client";

import { useSyncExternalStore } from "react";

import { defaultAiSettings, legacyModelChanges, parseAiSettings, type AiSettings } from "./ai-settings";

const storageKey = "pliegue-ai-settings-v1";
const changeEvent = "pliegue-ai-settings-change";

let cachedSerialized: string | null | undefined;
let cachedSettings = defaultAiSettings;

function readSettings() {
  try {
    const serialized = window.localStorage.getItem(storageKey);
    if (serialized === cachedSerialized) return cachedSettings;
    cachedSerialized = serialized;
    cachedSettings = serialized ? parseAiSettings(JSON.parse(serialized)) : defaultAiSettings;
  } catch {
    cachedSettings = defaultAiSettings;
  }
  return cachedSettings;
}

function subscribe(listener: () => void) {
  function handleStorage(event: StorageEvent) {
    if (event.key !== storageKey) return;
    cachedSerialized = undefined;
    listener();
  }

  window.addEventListener(changeEvent, listener);
  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener(changeEvent, listener);
    window.removeEventListener("storage", handleStorage);
  };
}

export function saveAiSettings(settings: AiSettings) {
  const parsed = parseAiSettings(settings);
  try {
    const serialized = JSON.stringify(parsed);
    window.localStorage.setItem(storageKey, serialized);
    cachedSerialized = serialized;
    cachedSettings = parsed;
  } catch {
    cachedSettings = parsed;
  }
  window.dispatchEvent(new Event(changeEvent));
}

/**
 * Modelos de partida antiguos que siguen guardados (04.2b): ya se usan los nuevos, y Ajustes lo
 * avisa hasta que se guarden los ajustes.
 */
export function storedLegacyModelChanges() {
  try {
    return legacyModelChanges(JSON.parse(window.localStorage.getItem(storageKey) ?? "null"));
  } catch {
    return [];
  }
}

/** Los ajustes de ahora, fuera de React (el freno del presupuesto los consulta). */
export function currentAiSettings() {
  return typeof window === "undefined" ? defaultAiSettings : readSettings();
}

export function useAiSettings() {
  return useSyncExternalStore(subscribe, readSettings, () => defaultAiSettings);
}

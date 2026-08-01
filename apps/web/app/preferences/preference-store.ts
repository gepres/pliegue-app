"use client";

import { useSyncExternalStore } from "react";

import {
  applyReadingProfile,
  emptyPreferenceState,
  parsePreferenceState,
  resolvePreferences,
  type PreferenceScope,
  type PreferenceState,
  type ReadingPreferences,
  type ReadingProfile,
  updateScopedPreference,
} from "./preferences";

const storageKey = "pliegue-preferences-v1";
const changeEvent = "pliegue-preferences-change";

let cachedSerialized: string | null | undefined;
let cachedState = emptyPreferenceState;

function readStoredState(): PreferenceState {
  const serialized = window.localStorage.getItem(storageKey);
  if (serialized === cachedSerialized) return cachedState;

  cachedSerialized = serialized;

  if (!serialized) {
    cachedState = emptyPreferenceState;
    return cachedState;
  }

  try {
    cachedState = parsePreferenceState(JSON.parse(serialized));
  } catch {
    cachedState = emptyPreferenceState;
  }

  return cachedState;
}

function getServerSnapshot() {
  return emptyPreferenceState;
}

function subscribe(onStoreChange: () => void) {
  function handleStorage(event: StorageEvent) {
    if (event.key !== storageKey) return;
    cachedSerialized = undefined;
    onStoreChange();
  }

  window.addEventListener(changeEvent, onStoreChange);
  window.addEventListener("storage", handleStorage);

  return () => {
    window.removeEventListener(changeEvent, onStoreChange);
    window.removeEventListener("storage", handleStorage);
  };
}

function persistState(state: PreferenceState) {
  const serialized = JSON.stringify(state);
  cachedSerialized = serialized;
  cachedState = state;
  window.localStorage.setItem(storageKey, serialized);
  window.dispatchEvent(new Event(changeEvent));
}

export function setPreference<Key extends keyof ReadingPreferences>(
  scope: PreferenceScope,
  key: Key,
  value: ReadingPreferences[Key] | undefined,
) {
  persistState(updateScopedPreference(readStoredState(), scope, key, value));
}

export function setReadingProfile(scope: PreferenceScope, profile: ReadingProfile) {
  persistState(applyReadingProfile(readStoredState(), scope, profile));
}

export function resetPreferenceScope(scope: PreferenceScope) {
  const state = readStoredState();
  persistState({
    ...state,
    scopes: { ...state.scopes, [scope]: {} },
  });
}

export function resetAllPreferences() {
  persistState(emptyPreferenceState);
}

export function usePreferences() {
  const state = useSyncExternalStore(subscribe, readStoredState, getServerSnapshot);
  return { resolved: resolvePreferences(state), state };
}

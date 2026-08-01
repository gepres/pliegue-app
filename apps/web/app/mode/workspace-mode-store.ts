"use client";

import { useSyncExternalStore } from "react";

import {
  defaultWorkspaceMode,
  parseWorkspaceMode,
  type WorkspaceModeState,
} from "./workspace-mode";

const storageKey = "pliegue-workspace-mode-v1";
const changeEvent = "pliegue-workspace-mode-change";

let cachedSerialized: string | null | undefined;
let cachedState = defaultWorkspaceMode;

function readWorkspaceMode(): WorkspaceModeState {
  const serialized = window.localStorage.getItem(storageKey);
  if (serialized === cachedSerialized) return cachedState;

  cachedSerialized = serialized;

  try {
    cachedState = parseWorkspaceMode(serialized ? JSON.parse(serialized) : null);
  } catch {
    cachedState = defaultWorkspaceMode;
  }

  return cachedState;
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

export function confirmLocalOnlyMode() {
  const state: WorkspaceModeState = {
    confirmedAt: new Date().toISOString(),
    mode: "local-only",
    version: 1,
  };
  const serialized = JSON.stringify(state);

  cachedSerialized = serialized;
  cachedState = state;
  window.localStorage.setItem(storageKey, serialized);
  window.dispatchEvent(new Event(changeEvent));
}

export function useWorkspaceMode() {
  return useSyncExternalStore(subscribe, readWorkspaceMode, () => defaultWorkspaceMode);
}

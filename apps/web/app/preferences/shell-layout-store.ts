"use client";

import { useSyncExternalStore } from "react";

import {
  defaultShellLayout,
  parseShellLayout,
  type ShellLayoutState,
} from "./shell-layout";

const storageKey = "pliegue-shell-layout-v1";
const changeEvent = "pliegue-shell-layout-change";

let cachedSerialized: string | null | undefined;
let cachedState = defaultShellLayout;

function readShellLayout(): ShellLayoutState {
  try {
    const serialized = window.localStorage.getItem(storageKey);
    if (serialized === cachedSerialized) return cachedState;

    cachedSerialized = serialized;
    cachedState = parseShellLayout(serialized ? JSON.parse(serialized) : null);
  } catch {
    cachedState = defaultShellLayout;
  }

  return cachedState;
}

function getServerSnapshot() {
  return defaultShellLayout;
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

export function setNavigationCollapsed(collapsed: boolean) {
  const state: ShellLayoutState = { navigationCollapsed: collapsed, version: 1 };
  const serialized = JSON.stringify(state);

  try {
    window.localStorage.setItem(storageKey, serialized);
    cachedSerialized = serialized;
    cachedState = state;
  } catch {
    // Sin almacenamiento la preferencia dura lo que la pestaña; plegar sigue funcionando.
    cachedSerialized = undefined;
    cachedState = state;
  }

  window.dispatchEvent(new Event(changeEvent));
}

export function useShellLayout() {
  return useSyncExternalStore(subscribe, readShellLayout, getServerSnapshot);
}

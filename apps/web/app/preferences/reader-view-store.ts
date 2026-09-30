"use client";

import { useSyncExternalStore } from "react";

import {
  defaultReaderView,
  parseReaderView,
  type ReaderMeasure,
  type ReaderViewState,
} from "./reader-view";

const storageKey = "pliegue-reader-view-v1";
const changeEvent = "pliegue-reader-view-change";

let cachedSerialized: string | null | undefined;
let cachedState = defaultReaderView;

function readReaderView(): ReaderViewState {
  try {
    const serialized = window.localStorage.getItem(storageKey);
    if (serialized === cachedSerialized) return cachedState;
    cachedSerialized = serialized;
    cachedState = parseReaderView(serialized ? JSON.parse(serialized) : null);
  } catch {
    cachedState = defaultReaderView;
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

export function setReaderMeasure(measure: ReaderMeasure) {
  const state: ReaderViewState = { measure, version: 1 };
  const serialized = JSON.stringify(state);
  try {
    window.localStorage.setItem(storageKey, serialized);
    cachedSerialized = serialized;
  } catch {
    cachedSerialized = undefined;
  }
  cachedState = state;
  window.dispatchEvent(new Event(changeEvent));
}

export function useReaderView() {
  return useSyncExternalStore(subscribe, readReaderView, () => defaultReaderView);
}

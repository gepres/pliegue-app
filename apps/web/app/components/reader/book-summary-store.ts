"use client";

import { useSyncExternalStore } from "react";

import type { BookSummary } from "../../ai/book-summary";
import type { SummaryProgress } from "../../ai/book-summarizer";
import type { AssistantFragment } from "../../ai/library-assistant";

/**
 * El resumen de un libro mientras se hace y al terminar, por libro y en memoria (04.5). Vive fuera
 * del componente: cerrar la ventanita del lector no lo para ni lo pierde. Lo que se queda para
 * siempre es la nota.
 */

export type BookSummaryState =
  | { status: "idle" }
  | { status: "preparing" }
  | { abort: AbortController; progress: SummaryProgress; status: "running" }
  | { model: string; noteId: string | null; providerName: string; result: BookSummary<AssistantFragment>; status: "done" }
  | { message: string; status: "error" | "blocked" };

const idle: BookSummaryState = { status: "idle" };
const states = new Map<string, BookSummaryState>();
const listeners = new Set<() => void>();

export function setBookSummaryState(documentId: string, state: BookSummaryState) {
  states.set(documentId, state);
  for (const listener of listeners) listener();
}

export function readBookSummaryState(documentId: string) {
  return states.get(documentId) ?? idle;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useBookSummaryState(documentId: string) {
  return useSyncExternalStore(
    subscribe,
    () => readBookSummaryState(documentId),
    () => idle,
  );
}

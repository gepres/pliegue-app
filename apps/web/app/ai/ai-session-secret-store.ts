"use client";

import { useSyncExternalStore } from "react";

import type { AiProvider } from "./document-catalog";

type SessionSecrets = Record<"anthropic" | "openai", string>;

const emptySecrets: SessionSecrets = { anthropic: "", openai: "" };
let secrets = emptySecrets;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(next: SessionSecrets) {
  secrets = next;
  for (const listener of listeners) listener();
}

export function setSessionApiKey(provider: "anthropic" | "openai", apiKey: string) {
  emit({ ...secrets, [provider]: apiKey.trim() });
}

export function clearSessionApiKey(provider: "anthropic" | "openai") {
  emit({ ...secrets, [provider]: "" });
}

export function getSessionApiKey(provider: AiProvider) {
  return provider === "ollama" ? "" : secrets[provider];
}

export function useAiSessionSecrets() {
  return useSyncExternalStore(subscribe, () => secrets, () => emptySecrets);
}

"use client";

import type { AiProvider } from "./document-catalog";
import { useAiSessionSecrets } from "./ai-session-secret-store";
import { useAiSettings } from "./ai-settings-store";
import { checkApiKey } from "./api-key";

export const catalogProviderNames: Record<AiProvider, string> = {
  anthropic: "Claude",
  gemini: "Gemini",
  ollama: "Ollama",
  openai: "OpenAI",
};

/**
 * ¿Se puede catalogar ya? Con Ollama, siempre (corre en el equipo); con un proveedor alojado,
 * si hay una clave en esta sesión y parece una clave. Es lo que decide si una sugerencia ofrece
 * «Catalogar con IA» o «Configurar una IA».
 */
export function useCatalogAi() {
  const settings = useAiSettings();
  const secrets = useAiSessionSecrets();
  const provider = settings.provider;
  const key = provider === "ollama" ? "" : secrets[provider];
  const ready = provider === "ollama" || (Boolean(key) && !checkApiKey(provider, key).error);
  return { providerName: catalogProviderNames[provider], ready, settings };
}

import type { AiProvider } from "./document-catalog";

export type HostedAiProvider = Exclude<AiProvider, "ollama">;

export interface ApiKeyCheck {
  /** Bloquea el envío: lo pegado no puede ser una credencial. */
  error: string | null;
  /** No bloquea, pero el formato no es el habitual del proveedor. */
  warning: string | null;
}

const minKeyLength = 20;
const maxKeyLength = 500;

const expectedPrefix: Record<HostedAiProvider, string> = {
  anthropic: "sk-ant-",
  openai: "sk-",
};

const providerLabel: Record<HostedAiProvider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
};

/**
 * Comprueba una credencial antes de enviarla a un tercero.
 *
 * La regla dura es la ausencia de espacios: ninguna API key los contiene, y un texto pegado
 * por error sí. Sin esta comprobación, cualquier cosa que hubiera en el portapapeles —el
 * contenido de un documento, una contraseña ajena— viaja al proveedor dentro de una cabecera.
 *
 * El prefijo solo avisa: los proveedores pueden cambiar su formato y bloquear por eso dejaría
 * fuera claves legítimas.
 */
export function checkApiKey(provider: HostedAiProvider, value: string): ApiKeyCheck {
  const trimmed = value.trim();

  if (!trimmed) {
    return { error: "Añade la API key de esta sesión.", warning: null };
  }
  if (/\s/.test(trimmed)) {
    return {
      error:
        "Esto no parece una API key: contiene espacios o saltos de línea. Revisa que no hayas pegado otro texto.",
      warning: null,
    };
  }
  if (trimmed.length < minKeyLength) {
    return { error: "La clave es demasiado corta para ser válida.", warning: null };
  }
  if (trimmed.length > maxKeyLength) {
    return {
      error: "El valor pegado es demasiado largo para ser una API key.",
      warning: null,
    };
  }

  return {
    error: null,
    warning: trimmed.startsWith(expectedPrefix[provider])
      ? null
      : `Las claves de ${providerLabel[provider]} suelen empezar por «${expectedPrefix[provider]}». Comprueba que sea la del proveedor seleccionado.`,
  };
}

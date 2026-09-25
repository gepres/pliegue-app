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

export interface NormalizedApiKey {
  /** Lo que se guarda y se envía. */
  key: string;
  /** Qué se quitó de lo pegado, para decirlo; vacío si nada. */
  removed: string[];
}

/** Nunca forman parte de una clave y se cuelan al copiar de una web o de un PDF. */
const invisibleCharacters = /[­​-‍⁠﻿]/g;

/**
 * Deja solo la clave de lo que se pega con ella al copiarla de otro sitio: las comillas de un
 * `.env`, el `Bearer` de una cabecera, el `NOMBRE=` de una variable, los caracteres invisibles
 * de una web. Los espacios de en medio no se tocan: una clave no los tiene y un texto pegado
 * por error sí, así que `checkApiKey` lo sigue rechazando. Los saltos de línea ya los quita el
 * propio campo al pegar.
 */
export function normalizeApiKey(value: string): NormalizedApiKey {
  const removed = new Set<string>();
  const visible = value.replace(invisibleCharacters, "");
  if (visible !== value) removed.add("caracteres invisibles");
  let key = visible.trim();

  // Dos pasadas: `"Bearer sk-…"` y `KEY="sk-…"` traen el envoltorio y las comillas en los dos órdenes.
  for (let pass = 0; pass < 2; pass += 1) {
    const wrapper =
      key.match(/^(?:authorization\s*:\s*)?bearer\s+/i) ??
      key.match(/^x-api-key\s*:\s*/i) ??
      key.match(/^(?:export\s+)?[a-z_][a-z0-9_]*\s*=\s*/i);
    if (wrapper) {
      key = key.slice(wrapper[0].length).trim();
      removed.add(
        /bearer/i.test(wrapper[0])
          ? "«Bearer»"
          : /x-api-key/i.test(wrapper[0])
            ? "«x-api-key:»"
            : "el nombre de la variable",
      );
    }

    const quoted = key.match(/^(["'`])([\s\S]*)\1$/);
    if (quoted) {
      key = (quoted[2] ?? "").trim();
      removed.add("las comillas");
    }
  }

  return { key, removed: [...removed] };
}

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

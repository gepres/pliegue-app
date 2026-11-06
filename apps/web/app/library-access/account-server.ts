import type { LibraryBaseConfig } from "./access-server";

/**
 * Borrar una cuenta de Pliegue (02.4), por decisión del dueño (6-nov): «Borrar mi cuenta», con
 * aviso. Se borra el usuario de Supabase Auth con la clave secreta, que solo vive en el
 * servidor; las tablas que cuelgan de él caen en cascada:
 * - `sync_items`: lo sincronizado (favoritos, progreso, notas, fichas, ajustes);
 * - `shared_libraries`: su biblioteca compartida, y con ella —por su disparador— sus códigos de
 *   acceso y el registro de entradas;
 * - `user_notices` y `pliegue_admins`.
 * Las traducciones del bucket `translations` (06.3) no cuelgan del usuario: se borran antes,
 * archivo a archivo, y si no se puede, la cuenta no se borra.
 * Lo que la cuenta dejó en otras tablas como autora (un aviso o una revisión de moderación)
 * se queda sin autor (`on delete set null`). Lo guardado en el navegador no se toca: se borra
 * aparte, con «Borrar todo en este navegador».
 */

/** Lo que el navegador manda para confirmar: sin ello, la ruta no borra nada. */
export const accountDeletionConfirmation = "borrar-mi-cuenta";

export interface AccountServerDeps {
  config: LibraryBaseConfig | null;
  fetcher?: typeof fetch;
}

export type DeleteAccountResult = { ok: true } | { ok: false; problem: "missing" | "unavailable" };

const translationsBucket = "translations";
const storagePage = 1000;

function secretHeaders(secretKey: string) {
  return {
    apikey: secretKey,
    // Las claves secretas nuevas (sb_secret_…) no son un JWT: van solo en `apikey`.
    ...(secretKey.startsWith("eyJ") ? { Authorization: `Bearer ${secretKey}` } : {}),
  };
}

interface StorageEntry {
  /** null en una carpeta. */
  id: string | null;
  name: string;
}

/**
 * Borra la carpeta de la cuenta en el bucket de traducciones: `{cuenta}/{libro}/{archivo}`.
 * Storage no borra carpetas, así que se listan los dos niveles y se borran los archivos. Sin
 * bucket (una instalación que no lo creó) no hay nada que borrar. Devuelve si quedó vacía.
 */
async function deleteTranslations(userId: string, config: LibraryBaseConfig, fetcher: typeof fetch) {
  const headers = { ...secretHeaders(config.secretKey), "Content-Type": "application/json" };
  const base = `${config.supabaseUrl}/storage/v1/object`;

  async function list(prefix: string): Promise<StorageEntry[] | "missing" | null> {
    const entries: StorageEntry[] = [];
    for (let offset = 0; ; offset += storagePage) {
      const response = await fetcher(`${base}/list/${translationsBucket}`, {
        body: JSON.stringify({ limit: storagePage, offset, prefix, sortBy: { column: "name", order: "asc" } }),
        cache: "no-store",
        headers,
        method: "POST",
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        return /bucket not found/i.test(text) ? "missing" : null;
      }
      const page = (await response.json()) as StorageEntry[];
      entries.push(...page);
      if (page.length < storagePage) return entries;
    }
  }

  const books = await list(userId);
  if (books === "missing") return true;
  if (!books) return false;
  const paths: string[] = [];
  for (const book of books) {
    if (book.id) {
      paths.push(`${userId}/${book.name}`);
      continue;
    }
    const files = await list(`${userId}/${book.name}`);
    if (files === "missing") continue;
    if (!files) return false;
    for (const file of files) if (file.id) paths.push(`${userId}/${book.name}/${file.name}`);
  }
  for (let start = 0; start < paths.length; start += storagePage) {
    const response = await fetcher(`${base}/${translationsBucket}`, {
      body: JSON.stringify({ prefixes: paths.slice(start, start + storagePage) }),
      cache: "no-store",
      headers,
      method: "DELETE",
    });
    if (!response.ok) return false;
  }
  return true;
}

export async function deleteAccount(userId: string, deps: AccountServerDeps): Promise<DeleteAccountResult> {
  const { config } = deps;
  if (!config || !/^[0-9a-f-]{36}$/i.test(userId)) return { ok: false, problem: "unavailable" };
  const fetcher = deps.fetcher ?? fetch;
  try {
    // Primero lo que no cae en cascada: sin las traducciones borradas, la cuenta no se borra.
    if (!(await deleteTranslations(userId, config, fetcher))) return { ok: false, problem: "unavailable" };
    const response = await fetcher(`${config.supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
      cache: "no-store",
      headers: secretHeaders(config.secretKey),
      method: "DELETE",
    });
    if (response.ok) return { ok: true };
    return { ok: false, problem: response.status === 404 ? "missing" : "unavailable" };
  } catch {
    return { ok: false, problem: "unavailable" };
  }
}

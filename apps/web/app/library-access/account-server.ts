import type { LibraryBaseConfig } from "./access-server";

/**
 * Borrar una cuenta de Pliegue (02.4), por decisión del dueño (6-nov): «Borrar mi cuenta», con
 * aviso. Se borra el usuario de Supabase Auth con la clave secreta, que solo vive en el
 * servidor; las tablas que cuelgan de él caen en cascada:
 * - `sync_items`: lo sincronizado (favoritos, progreso, notas, fichas, ajustes);
 * - `shared_libraries`: su biblioteca compartida, y con ella —por su disparador— sus códigos de
 *   acceso y el registro de entradas;
 * - `user_notices` y `pliegue_admins`.
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

export async function deleteAccount(userId: string, deps: AccountServerDeps): Promise<DeleteAccountResult> {
  const { config } = deps;
  if (!config || !/^[0-9a-f-]{36}$/i.test(userId)) return { ok: false, problem: "unavailable" };
  try {
    const response = await (deps.fetcher ?? fetch)(`${config.supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
      cache: "no-store",
      headers: {
        apikey: config.secretKey,
        // Las claves secretas nuevas (sb_secret_…) no son un JWT: van solo en `apikey`.
        ...(config.secretKey.startsWith("eyJ") ? { Authorization: `Bearer ${config.secretKey}` } : {}),
      },
      method: "DELETE",
    });
    if (response.ok) return { ok: true };
    return { ok: false, problem: response.status === 404 ? "missing" : "unavailable" };
  } catch {
    return { ok: false, problem: "unavailable" };
  }
}

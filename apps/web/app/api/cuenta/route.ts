import { accountDeletionConfirmation, deleteAccount } from "../../library-access/account-server";
import { readLibraryBaseConfig } from "../../library-access/access-server";
import { sessionUser } from "../../library-access/shared-library-server";

/**
 * Borrar la cuenta de quien la pide (DELETE, 02.4). Llega con la sesión de Pliegue
 * (`Authorization`) y con `{ "confirm": "borrar-mi-cuenta" }`: sin esa confirmación explícita
 * no se borra nada, aunque la sesión sea válida. Solo se borra la propia cuenta: el servidor
 * saca el usuario de la sesión, nunca del cuerpo.
 */

/** Solo desde las páginas de Pliegue. */
function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

const fail = (status: number, error: string) => Response.json({ error }, { status });

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return fail(403, "Origen no permitido.");
  const raw = await request.text();
  if (raw.length > 500) return fail(413, "La solicitud supera el límite permitido.");
  let body: { confirm?: unknown } = {};
  try {
    body = JSON.parse(raw || "{}") as typeof body;
  } catch {
    return fail(400, "Solicitud JSON no válida.");
  }
  if (body.confirm !== accountDeletionConfirmation) return fail(400, "Falta confirmar que quieres borrar la cuenta.");

  const config = readLibraryBaseConfig();
  if (!config) return fail(503, "Esta instalación no puede borrar cuentas ahora. Inténtalo más tarde.");
  const accessToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const user = await sessionUser(accessToken, { config });
  if (!user) return fail(401, "Tu sesión caducó. Vuelve a entrar y repite el borrado.");

  const deleted = await deleteAccount(user.id, { config });
  if (!deleted.ok) {
    return deleted.problem === "missing"
      ? fail(404, "Esa cuenta ya no existe.")
      : fail(503, "No se pudo borrar la cuenta ahora. No se borró nada; inténtalo dentro de un rato.");
  }
  return Response.json({ ok: true });
}

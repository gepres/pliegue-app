import { readLibraryBaseConfig } from "../../../library-access/access-server";
import { isSharedLibrarySlug } from "../../../library-access/library-slug";
import {
  createProblemMessages,
  folderProblemMessages,
  insertSharedLibrary,
  inspectDriveFolder,
  readDriveApiUrl,
  sessionUser,
} from "../../../library-access/shared-library-server";
import { sharedLibraryTermsVersion } from "../../../library-access/shared-library-terms";

/**
 * Crear la biblioteca compartida de una cuenta (POST). Llega con la sesión de Pliegue
 * (`Authorization`) y el token de Drive con el que se eligió la carpeta; el servidor comprueba
 * la cuenta, que la carpeta es suya y pública, y la crea. El token de Drive no se guarda.
 */

/** Solo desde las páginas de Pliegue. */
function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

const fail = (status: number, error: string, reason?: string) => Response.json({ error, ...(reason ? { reason } : {}) }, { status });

export async function POST(request: Request) {
  if (!sameOrigin(request)) return fail(403, "Origen no permitido.");
  const raw = await request.text();
  if (raw.length > 4_000) return fail(413, "La solicitud supera el límite permitido.");

  let body: { driveToken?: unknown; folderId?: unknown; name?: unknown; slug?: unknown; termsVersion?: unknown };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return fail(400, "Solicitud JSON no válida.");
  }
  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  const name = typeof body.name === "string" ? body.name.normalize("NFC").replace(/\s+/g, " ").trim() : "";
  const folderId = typeof body.folderId === "string" && /^[A-Za-z0-9_-]{10,200}$/.test(body.folderId) ? body.folderId : null;
  const driveToken = typeof body.driveToken === "string" && body.driveToken.length <= 4_000 ? body.driveToken : "";
  if (!isSharedLibrarySlug(slug)) {
    return fail(400, "La dirección lleva de 2 a 40 letras minúsculas, números y guiones sueltos, y empieza por letra.", "slug");
  }
  if (!name || Array.from(name).length > 80) return fail(400, "Ponle a la biblioteca un nombre de hasta 80 caracteres.", "name");
  if (!folderId) return fail(400, "Elige la carpeta de Drive de la biblioteca.", "folder");
  if (body.termsVersion !== sharedLibraryTermsVersion) return fail(400, "Acepta las normas para crear la biblioteca.", "terms");
  if (!driveToken) return fail(400, "Vuelve a conectar Drive y elige la carpeta otra vez.", "drive");

  const config = readLibraryBaseConfig();
  if (!config) return fail(503, createProblemMessages.unavailable, "unavailable");
  const accessToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const user = await sessionUser(accessToken, { config });
  if (!user) return fail(401, "Inicia sesión con tu cuenta de Pliegue para crear tu biblioteca.", "session");

  const folder = await inspectDriveFolder(folderId, driveToken, { driveApiUrl: readDriveApiUrl() });
  if (!folder.ok) return fail(400, folderProblemMessages[folder.problem], folder.problem);

  const created = await insertSharedLibrary({ folderId, name, ownerId: user.id, slug, termsVersion: sharedLibraryTermsVersion }, { config });
  if (!created.ok) return fail(created.problem === "unavailable" ? 503 : 409, createProblemMessages[created.problem], created.problem);
  return Response.json({ ok: true, slug }, { status: 201 });
}

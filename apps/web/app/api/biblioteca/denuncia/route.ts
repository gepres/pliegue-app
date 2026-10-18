import { clientFingerprint, readLibraryBaseConfig, readSharedLibraryAccess } from "../../../library-access/access-server";
import { librarySessionCookieName } from "../../../library-access/access-session";
import { isSharedLibrarySlug } from "../../../library-access/library-slug";
import { isReportReason } from "../../../library-access/report-reasons";
import { submitLibraryReport } from "../../../library-access/shared-library-server";

/**
 * Denunciar una biblioteca compartida o uno de sus libros (POST). Solo puede quien está dentro:
 * la sesión de esa biblioteca (su cookie) dice con qué código, nombre y equipo entró. La denuncia
 * le llega al administrador de Pliegue; el dueño de la biblioteca no la ve.
 */

/** Solo desde las páginas de Pliegue. */
function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function clientIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "";
}

function cookieValue(request: Request, name: string) {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return undefined;
}

const fail = (status: number, error: string, reason: string) => Response.json({ error, reason }, { status });

export async function POST(request: Request) {
  if (!sameOrigin(request)) return fail(403, "Origen no permitido.", "origin");
  const raw = await request.text();
  if (raw.length > 4_000) return fail(413, "La solicitud supera el límite permitido.", "size");

  let body: { details?: unknown; fileId?: unknown; library?: unknown; reason?: unknown };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return fail(400, "Solicitud JSON no válida.", "json");
  }
  const library = typeof body.library === "string" && isSharedLibrarySlug(body.library) ? body.library : null;
  const details = typeof body.details === "string" ? body.details.normalize("NFC").trim() : "";
  const fileId = typeof body.fileId === "string" && /^[A-Za-z0-9_-]{10,200}$/.test(body.fileId) ? body.fileId : null;
  if (!library) return fail(400, "Esa biblioteca no existe.", "library");
  if (!isReportReason(body.reason)) return fail(400, "Elige el motivo de la denuncia.", "reason");
  if (Array.from(details).length > 1_000) return fail(400, "El texto llega hasta 1.000 caracteres.", "details");
  if (body.fileId !== undefined && body.fileId !== null && !fileId) return fail(400, "Ese libro no existe.", "file");

  const config = readLibraryBaseConfig();
  if (!config) return fail(503, "No fue posible enviar la denuncia ahora mismo. Inténtalo más tarde.", "unavailable");
  const access = await readSharedLibraryAccess(library, cookieValue(request, librarySessionCookieName(library)), { config });
  if (!access) return fail(401, "Para denunciar hay que estar dentro de la biblioteca con un código.", "session");

  const outcome = await submitLibraryReport(
    {
      clientHash: await clientFingerprint(clientIp(request), config.sessionSecret),
      codeId: access.session.codeId,
      details,
      deviceId: access.session.device,
      fileId,
      library,
      reason: body.reason,
      visitorName: access.session.name,
    },
    { config },
  );
  if (outcome === "ok") return Response.json({ ok: true }, { status: 201 });
  if (outcome === "too-many") return fail(429, "Ya enviaste varias denuncias hoy. Si hay algo más, vuelve mañana.", "too-many");
  if (outcome === "invalid") return fail(404, "Esa biblioteca no existe.", "library");
  return fail(503, "No fue posible enviar la denuncia ahora mismo. Inténtalo más tarde.", "unavailable");
}

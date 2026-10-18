import { NextResponse } from "next/server";

import { readLibraryBaseConfig, readLibraryServerConfig, redeemAccessCode, redeemMessages } from "../../../library-access/access-server";
import { librarySessionCookieName, normalizeVisitorName } from "../../../library-access/access-session";
import { generalLibrary, isSharedLibrarySlug } from "../../../library-access/library-slug";

/**
 * Entrar en una biblioteca con un código (POST) y salir (DELETE). La sesión va en una cookie
 * httpOnly: el navegador no la lee y solo viaja a Pliegue. Sin `library`, la biblioteca general;
 * con ella, la compartida de esa dirección, cada una con su cookie.
 */

const statusByReason = { closed: 403, expired: 403, exhausted: 403, invalid: 401, "too-many": 429, unavailable: 503 } as const;

/** Solo desde las páginas de Pliegue: otro sitio no puede hacer entrar ni salir a nadie. */
function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function clientIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "";
}

/** La biblioteca que se pide: la general si no se dice; `null` si no puede ser ninguna. */
function requestedLibrary(value: unknown) {
  if (value === undefined || value === null || value === generalLibrary) return generalLibrary;
  return typeof value === "string" && isSharedLibrarySlug(value) ? value : null;
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Origen no permitido." }, { status: 403 });
  const raw = await request.text();
  if (raw.length > 2_000) return Response.json({ error: "La solicitud supera el límite permitido." }, { status: 413 });

  let body: { code?: unknown; deviceId?: unknown; library?: unknown; name?: unknown };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return Response.json({ error: "Solicitud JSON no válida." }, { status: 400 });
  }
  const library = requestedLibrary(body.library);
  const name = typeof body.name === "string" ? normalizeVisitorName(body.name) : null;
  const deviceId = typeof body.deviceId === "string" && /^[\w-]{8,64}$/.test(body.deviceId) ? body.deviceId : null;
  if (!library) return Response.json({ error: "Esa biblioteca no existe." }, { status: 400 });
  if (typeof body.code !== "string" || !body.code.trim()) return Response.json({ error: "Escribe el código de acceso." }, { status: 400 });
  if (!name) return Response.json({ error: "Escribe tu nombre para entrar." }, { status: 400 });
  if (!deviceId) return Response.json({ error: "Este navegador no pudo identificarse. Recarga la página." }, { status: 400 });

  const outcome = await redeemAccessCode(
    { code: body.code, deviceId, ip: clientIp(request), library, name, userAgent: request.headers.get("user-agent") ?? "" },
    // La general necesita además su carpeta; una compartida la tiene en la base.
    { config: library === generalLibrary ? readLibraryServerConfig() : readLibraryBaseConfig() },
  );
  if (!outcome.ok) {
    return Response.json({ error: redeemMessages[outcome.reason], reason: outcome.reason }, { status: statusByReason[outcome.reason] });
  }

  const response = NextResponse.json({ name: outcome.session.name, ok: true });
  response.cookies.set(librarySessionCookieName(library), outcome.cookie.value, {
    httpOnly: true,
    maxAge: outcome.cookie.maxAgeSeconds,
    path: "/",
    sameSite: "lax",
    secure: new URL(request.url).protocol === "https:",
  });
  return response;
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Origen no permitido." }, { status: 403 });
  const library = requestedLibrary(new URL(request.url).searchParams.get("library"));
  if (!library) return Response.json({ error: "Esa biblioteca no existe." }, { status: 400 });
  const response = NextResponse.json({ ok: true });
  response.cookies.set(librarySessionCookieName(library), "", { httpOnly: true, maxAge: 0, path: "/", sameSite: "lax" });
  return response;
}

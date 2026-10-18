import { describe, expect, it } from "vitest";

import {
  accessCodeId,
  accessCodeStillValid,
  findSharedLibrary,
  readGeneralLibraryAccess,
  readLibraryBaseConfig,
  readLibraryServerConfig,
  readSharedLibraryAccess,
  redeemAccessCode,
  type LibraryServerConfig,
} from "./access-server";
import {
  librarySessionCookieName,
  maxSessionMs,
  normalizeAccessCode,
  normalizeVisitorName,
  sessionCookieName,
  sessionExpiry,
  signSession,
  verifySession,
  type LibrarySession,
} from "./access-session";

const now = Date.parse("2026-10-03T12:00:00.000Z");
const session: LibrarySession = { codeId: "c1", device: "d1", exp: now + 60_000, iat: now, library: "general", name: "Ana", v: 1 };
const config: LibraryServerConfig = { folderId: "carpeta", secretKey: "sb_secret_x", sessionSecret: "secreto", supabaseUrl: "https://db.example" };

describe("sesión firmada", () => {
  it("firma y verifica; rechaza la manipulada, la de otro secreto y la caducada", async () => {
    const token = await signSession(session, "secreto");
    expect(await verifySession(token, "secreto", now)).toEqual(session);

    const [data, signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...session, name: "Intruso" })).toString("base64url");
    expect(await verifySession(`${forged}.${signature}`, "secreto", now)).toBeNull();
    expect(await verifySession(`${data}.${signature}x`, "secreto", now)).toBeNull();
    expect(await verifySession(token, "otro", now)).toBeNull();
    expect(await verifySession(token, "secreto", now + 60_001)).toBeNull();
    expect(await verifySession("basura", "secreto", now)).toBeNull();
    expect(await verifySession(undefined, "secreto", now)).toBeNull();
  });

  it("caduca a los treinta días o con el código, lo que llegue antes", () => {
    expect(sessionExpiry(now, null)).toBe(now + maxSessionMs);
    expect(sessionExpiry(now, "2026-10-05T12:00:00.000Z")).toBe(Date.parse("2026-10-05T12:00:00.000Z"));
    expect(sessionExpiry(now, "2027-10-05T12:00:00.000Z")).toBe(now + maxSessionMs);
  });

  it("normaliza el código y el nombre", () => {
    expect(normalizeAccessCode("  oct2026 arequipa ")).toBe("OCT2026AREQUIPA");
    expect(normalizeAccessCode("ab")).toBeNull();
    expect(normalizeAccessCode("con;punto")).toBeNull();
    expect(normalizeVisitorName("  Ana \n María  ")).toBe("Ana María");
    expect(normalizeVisitorName("   ")).toBeNull();
    expect(normalizeVisitorName("x".repeat(80))).toHaveLength(60);
    expect(Array.from(normalizeVisitorName("😀".repeat(80)) ?? "")).toHaveLength(60);
  });
});

/** Un Supabase de mentira que responde al canje y a las consultas del código, del registro y de la biblioteca. */
function supabase(rows: { redeem?: unknown; code?: unknown; events?: unknown; library?: unknown; status?: number }) {
  const calls: Array<{ body: unknown; headers: Record<string, string>; url: string }> = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    calls.push({ body: init?.body ? JSON.parse(String(init.body)) : null, headers: init?.headers as Record<string, string>, url });
    if (rows.status) return new Response("{}", { status: rows.status });
    const payload = url.includes("/rpc/")
      ? rows.redeem
      : url.includes("/library_access_events")
        ? (rows.events ?? [{ visitor_name: "Ana" }])
        : url.includes("/shared_libraries")
          ? rows.library
          : rows.code;
    return new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json" }, status: 200 });
  }) as typeof fetch;
  return { calls, fetcher };
}

describe("canjear un código", () => {
  const input = { code: "oct2026arequipa", deviceId: "equipo-1", ip: "203.0.113.9", name: "Ana", userAgent: "Mozilla/5.0" };

  it("con un código bueno da una sesión y llama a Supabase con la clave secreta, sin la IP", async () => {
    const db = supabase({ redeem: [{ code_id: "c1", expires_at: null, ok: true, reason: "ok" }] });
    const outcome = await redeemAccessCode(input, { config, fetcher: db.fetcher, now: () => now });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.session).toMatchObject({ codeId: "c1", device: "equipo-1", library: "general", name: "Ana" });
    expect(outcome.cookie.maxAgeSeconds).toBe(maxSessionMs / 1000);
    expect(await verifySession(outcome.cookie.value, "secreto", now)).toEqual(outcome.session);

    const call = db.calls[0];
    expect(call?.url).toBe("https://db.example/rest/v1/rpc/redeem_library_code");
    expect(call?.headers.apikey).toBe("sb_secret_x");
    expect(call?.headers.Authorization).toBeUndefined();
    expect(call?.body).toMatchObject({ p_code: "OCT2026AREQUIPA", p_library: "general", p_visitor_name: "Ana" });
    expect(JSON.stringify(call?.body)).not.toContain("203.0.113.9");
  });

  it("con la service_role antigua (un JWT) la manda también como portador", async () => {
    const db = supabase({ redeem: [{ code_id: "c1", expires_at: null, ok: true, reason: "ok" }] });
    await redeemAccessCode(input, { config: { ...config, secretKey: "eyJhbGciOi.x.y" }, fetcher: db.fetcher });
    expect(db.calls[0]?.headers.Authorization).toBe("Bearer eyJhbGciOi.x.y");
  });

  it("dice por qué no entra", async () => {
    for (const reason of ["invalid", "expired", "exhausted", "too-many"] as const) {
      const db = supabase({ redeem: [{ code_id: null, expires_at: null, ok: false, reason }] });
      expect(await redeemAccessCode(input, { config, fetcher: db.fetcher })).toEqual({ ok: false, reason });
    }
    expect(await redeemAccessCode({ ...input, code: "x" }, { config, fetcher: supabase({}).fetcher })).toEqual({ ok: false, reason: "invalid" });
    expect(await redeemAccessCode(input, { config, fetcher: supabase({ status: 500 }).fetcher })).toEqual({ ok: false, reason: "unavailable" });
    expect(await redeemAccessCode(input, { config: null })).toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("leer el acceso en cada visita", () => {
  it("vale con la cookie buena, el código activo y la persona en el registro; deja de valer si no", async () => {
    const cookie = await signSession(session, "secreto");
    const active = supabase({ code: [{ active: true, expires_at: null }] });
    expect(await readGeneralLibraryAccess(cookie, { config, fetcher: active.fetcher, now: () => now })).toEqual({ folderId: "carpeta", session });
    expect(active.calls.map((call) => call.url).sort()).toEqual([
      "https://db.example/rest/v1/library_access_codes?id=eq.c1&select=active%2Cexpires_at",
      "https://db.example/rest/v1/library_access_events?code_id=eq.c1&device_id=eq.d1&select=visitor_name",
    ]);

    // El administrador la quitó del registro: fuera en la próxima visita. Una vuelta con otras mayúsculas sigue valiendo.
    const removed = supabase({ code: [{ active: true, expires_at: null }], events: [{ visitor_name: "Luis" }] });
    expect(await readGeneralLibraryAccess(cookie, { config, fetcher: removed.fetcher, now: () => now })).toBeNull();
    const otherCase = supabase({ code: [{ active: true, expires_at: null }], events: [{ visitor_name: "ANA" }] });
    expect(await readGeneralLibraryAccess(cookie, { config, fetcher: otherCase.fetcher, now: () => now })).toEqual({ folderId: "carpeta", session });

    const off = supabase({ code: [{ active: false, expires_at: null }] });
    expect(await readGeneralLibraryAccess(cookie, { config, fetcher: off.fetcher, now: () => now })).toBeNull();
    expect(await accessCodeStillValid("c1", { config, fetcher: supabase({ code: [{ active: true, expires_at: "2026-10-03T11:00:00.000Z" }] }).fetcher, now: () => now })).toBe(false);
    expect(await accessCodeStillValid("c1", { config, fetcher: supabase({ code: [] }).fetcher, now: () => now })).toBe(false);
    expect(await readGeneralLibraryAccess("falsa.firma", { config, fetcher: active.fetcher, now: () => now })).toBeNull();
  });

  it("busca el código de un enlace para saber si es el mismo con el que se entró", async () => {
    const db = supabase({ code: [{ id: "c1" }] });
    expect(await accessCodeId(" oct2026arequipa ", { config, fetcher: db.fetcher })).toBe("c1");
    expect(db.calls[0]?.url).toBe("https://db.example/rest/v1/library_access_codes?code=eq.OCT2026AREQUIPA&library=eq.general&select=id");
    expect(await accessCodeId("x", { config, fetcher: db.fetcher })).toBeNull();
    expect(db.calls).toHaveLength(1);
    expect(await accessCodeId("NOEXISTE", { config, fetcher: supabase({ code: [] }).fetcher })).toBeNull();
  });

  it("lee la configuración del entorno y no arranca a medias", () => {
    expect(readLibraryServerConfig({})).toBeNull();
    expect(readLibraryServerConfig({ NEXT_PUBLIC_SUPABASE_URL: "https://db.example/", PLIEGUE_GENERAL_FOLDER_ID: "f", SUPABASE_SECRET_KEY: "k" })).toEqual({
      folderId: "f",
      secretKey: "k",
      sessionSecret: "k",
      supabaseUrl: "https://db.example",
    });
    expect(
      readLibraryServerConfig({ PLIEGUE_GENERAL_FOLDER_ID: "f", PLIEGUE_LIBRARY_SECRET: "s", SUPABASE_SERVICE_ROLE_KEY: "old", SUPABASE_URL: "https://otra" })
        ?.sessionSecret,
    ).toBe("s");
  });

  it("las compartidas no necesitan la carpeta de la general", () => {
    const environment = { NEXT_PUBLIC_SUPABASE_URL: "https://db.example/", SUPABASE_SECRET_KEY: "k" };
    expect(readLibraryServerConfig(environment)).toBeNull();
    expect(readLibraryBaseConfig(environment)).toEqual({ secretKey: "k", sessionSecret: "k", supabaseUrl: "https://db.example" });
    expect(readLibraryBaseConfig({ SUPABASE_SECRET_KEY: "k" })).toBeNull();
  });
});

describe("bibliotecas compartidas", () => {
  const input = { code: "oct26", deviceId: "equipo-1", ip: "203.0.113.9", library: "ana-lopez", name: "Ana", userAgent: "Mozilla/5.0" };
  const shared: LibrarySession = { ...session, library: "ana-lopez" };
  const anaLibrary = [{ active: true, folder_id: "carpeta-de-ana", name: "Los libros de Ana" }];

  it("cada biblioteca con su cookie; la general conserva la de siempre", () => {
    expect(sessionCookieName).toBe("pliegue-biblioteca-general");
    expect(librarySessionCookieName("general")).toBe(sessionCookieName);
    expect(librarySessionCookieName("ana-lopez")).toBe("pliegue-biblioteca-ana-lopez");
  });

  it("canjea en la biblioteca que se pide y la sesión queda atada a ella", async () => {
    const db = supabase({ redeem: [{ code_id: "c9", expires_at: null, ok: true, reason: "ok" }] });
    const outcome = await redeemAccessCode(input, { config, fetcher: db.fetcher, now: () => now });
    expect(outcome.ok && outcome.session.library).toBe("ana-lopez");
    expect(db.calls[0]?.body).toMatchObject({ p_code: "OCT26", p_library: "ana-lopez" });
  });

  it("una biblioteca pausada dice que está cerrada; una dirección imposible ni pregunta", async () => {
    const closed = supabase({ redeem: [{ code_id: null, expires_at: null, ok: false, reason: "closed" }] });
    expect(await redeemAccessCode(input, { config, fetcher: closed.fetcher })).toEqual({ ok: false, reason: "closed" });
    for (const library of ["leer", "Ana Lopez", ""]) {
      const db = supabase({});
      expect(await redeemAccessCode({ ...input, library }, { config, fetcher: db.fetcher })).toEqual({ ok: false, reason: "invalid" });
      expect(db.calls).toHaveLength(0);
    }
  });

  it("vale con la sesión de esa biblioteca, abierta, con el código activo y la persona en el registro", async () => {
    const cookie = await signSession(shared, "secreto");
    const open = supabase({ code: [{ active: true, expires_at: null }], library: anaLibrary });
    expect(await readSharedLibraryAccess("ana-lopez", cookie, { config, fetcher: open.fetcher, now: () => now })).toEqual({
      library: { folderId: "carpeta-de-ana", name: "Los libros de Ana", slug: "ana-lopez" },
      session: shared,
    });
    expect(open.calls.map((call) => call.url)).toContain("https://db.example/rest/v1/shared_libraries?select=folder_id%2Cname%2Cactive&slug=eq.ana-lopez");

    const paused = supabase({ code: [{ active: true, expires_at: null }], library: [{ ...anaLibrary[0], active: false }] });
    expect(await readSharedLibraryAccess("ana-lopez", cookie, { config, fetcher: paused.fetcher, now: () => now })).toBeNull();
    const gone = supabase({ code: [{ active: true, expires_at: null }], library: [] });
    expect(await readSharedLibraryAccess("ana-lopez", cookie, { config, fetcher: gone.fetcher, now: () => now })).toBeNull();
    const codeOff = supabase({ code: [{ active: false, expires_at: null }], library: anaLibrary });
    expect(await readSharedLibraryAccess("ana-lopez", cookie, { config, fetcher: codeOff.fetcher, now: () => now })).toBeNull();
  });

  it("la sesión de una biblioteca no abre otra, ni la general", async () => {
    const db = supabase({ code: [{ active: true, expires_at: null }], library: anaLibrary });
    const deps = { config, fetcher: db.fetcher, now: () => now };
    const anaCookie = await signSession(shared, "secreto");
    const generalCookie = await signSession(session, "secreto");
    expect(await readSharedLibraryAccess("beto", anaCookie, deps)).toBeNull();
    expect(await readGeneralLibraryAccess(anaCookie, deps)).toBeNull();
    expect(await readSharedLibraryAccess("ana-lopez", generalCookie, deps)).toBeNull();
    expect(await readSharedLibraryAccess("general", generalCookie, deps)).toBeNull();
    expect(db.calls).toHaveLength(0);
  });

  it("busca el código de un enlace dentro de su biblioteca", async () => {
    const db = supabase({ code: [{ id: "c9" }] });
    expect(await accessCodeId("oct26", { config, fetcher: db.fetcher }, "ana-lopez")).toBe("c9");
    expect(db.calls[0]?.url).toBe("https://db.example/rest/v1/library_access_codes?code=eq.OCT26&library=eq.ana-lopez&select=id");
  });

  it("encuentra la biblioteca abierta y nada más", async () => {
    expect(await findSharedLibrary("ana-lopez", { config, fetcher: supabase({ library: anaLibrary }).fetcher })).toEqual({
      folderId: "carpeta-de-ana",
      name: "Los libros de Ana",
      slug: "ana-lopez",
    });
    expect(await findSharedLibrary("ana-lopez", { config, fetcher: supabase({ status: 500 }).fetcher })).toBeNull();
    expect(await findSharedLibrary("general", { config, fetcher: supabase({ library: anaLibrary }).fetcher })).toBeNull();
    expect(await findSharedLibrary("ana-lopez", { config: null })).toBeNull();
  });
});

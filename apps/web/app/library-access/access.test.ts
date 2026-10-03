import { describe, expect, it } from "vitest";

import {
  accessCodeStillValid,
  readGeneralLibraryAccess,
  readLibraryServerConfig,
  redeemAccessCode,
  type LibraryServerConfig,
} from "./access-server";
import {
  maxSessionMs,
  normalizeAccessCode,
  normalizeVisitorName,
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
  });
});

/** Un Supabase de mentira que responde al canje y a la consulta del código. */
function supabase(rows: { redeem?: unknown; code?: unknown; status?: number }) {
  const calls: Array<{ body: unknown; headers: Record<string, string>; url: string }> = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    calls.push({ body: init?.body ? JSON.parse(String(init.body)) : null, headers: init?.headers as Record<string, string>, url });
    if (rows.status) return new Response("{}", { status: rows.status });
    const payload = url.includes("/rpc/") ? rows.redeem : rows.code;
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
  it("vale con la cookie buena y el código activo; deja de valer si se desactiva o caduca", async () => {
    const cookie = await signSession(session, "secreto");
    const active = supabase({ code: [{ active: true, expires_at: null }] });
    expect(await readGeneralLibraryAccess(cookie, { config, fetcher: active.fetcher, now: () => now })).toEqual({ folderId: "carpeta", session });
    expect(active.calls[0]?.url).toBe("https://db.example/rest/v1/library_access_codes?id=eq.c1&select=active%2Cexpires_at");

    const off = supabase({ code: [{ active: false, expires_at: null }] });
    expect(await readGeneralLibraryAccess(cookie, { config, fetcher: off.fetcher, now: () => now })).toBeNull();
    expect(await accessCodeStillValid("c1", { config, fetcher: supabase({ code: [{ active: true, expires_at: "2026-10-03T11:00:00.000Z" }] }).fetcher, now: () => now })).toBe(false);
    expect(await accessCodeStillValid("c1", { config, fetcher: supabase({ code: [] }).fetcher, now: () => now })).toBe(false);
    expect(await readGeneralLibraryAccess("falsa.firma", { config, fetcher: active.fetcher, now: () => now })).toBeNull();
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
});

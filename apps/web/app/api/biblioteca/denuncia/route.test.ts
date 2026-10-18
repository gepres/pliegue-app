import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { signSession, type LibrarySession } from "../../../library-access/access-session";
import { POST } from "./route";

const now = Date.now();
const session: LibrarySession = { codeId: "c9", device: "equipo-1", exp: now + 3_600_000, iat: now, library: "ana-lopez", name: "Marta", v: 1 };

async function request(body: Record<string, unknown> = {}, cookie: string | null = null) {
  const value = cookie ?? `pliegue-biblioteca-ana-lopez=${await signSession(session, "secreto-e2e")}`;
  return new Request("http://localhost/api/biblioteca/denuncia", {
    body: JSON.stringify({ details: "Libros con derechos", library: "ana-lopez", reason: "derechos", ...body }),
    headers: { "content-type": "application/json", cookie: value },
    method: "POST",
  });
}

/** Supabase de mentira: la sesión vale (código activo, persona registrada, biblioteca abierta) y la denuncia responde `submit`. */
function stubSupabase({ library = [{ active: true, folder_id: "carpeta", name: "Ana", suspended_at: null }] as unknown, submit = [{ ok: true, reason: "ok" }] as unknown } = {}) {
  const calls: Array<{ body: unknown; url: string }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ body: init?.body ? JSON.parse(String(init.body)) : null, url });
      if (url.includes("/rpc/submit_library_report")) return Response.json(submit);
      if (url.includes("/shared_libraries")) return Response.json(library);
      if (url.includes("/library_access_events")) return Response.json([{ visitor_name: "Marta" }]);
      if (url.includes("/library_access_codes")) return Response.json([{ active: true, expires_at: null }]);
      return Response.json({}, { status: 404 });
    }),
  );
  return calls;
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://db.example");
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_x");
  vi.stubEnv("PLIEGUE_LIBRARY_SECRET", "secreto-e2e");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("denunciar una biblioteca compartida", () => {
  it("con la sesión de esa biblioteca, la manda con su código, su nombre y su equipo", async () => {
    const calls = stubSupabase();
    const response = await POST(await request({ fileId: "libro-de-ana-0001" }));
    expect(response.status).toBe(201);
    const submit = calls.find((call) => call.url.endsWith("/rpc/submit_library_report"));
    expect(submit?.body).toMatchObject({
      p_code_id: "c9",
      p_details: "Libros con derechos",
      p_device_id: "equipo-1",
      p_file_id: "libro-de-ana-0001",
      p_library: "ana-lopez",
      p_reason: "derechos",
      p_visitor_name: "Marta",
    });
    expect(String((submit?.body as { p_client_hash?: string }).p_client_hash)).toMatch(/^[0-9a-f]{32}$/);
  });

  it("sin estar dentro de ella no se puede", async () => {
    const calls = stubSupabase();
    expect((await POST(await request({}, "otra=cookie"))).status).toBe(401);
    const otherLibrary = `pliegue-biblioteca-ana-lopez=${await signSession({ ...session, library: "beto" }, "secreto-e2e")}`;
    expect((await POST(await request({}, otherLibrary))).status).toBe(401);
    expect(calls.some((call) => call.url.includes("submit_library_report"))).toBe(false);
  });

  it("una biblioteca suspendida ya no se puede denunciar desde dentro: nadie está dentro", async () => {
    stubSupabase({ library: [{ active: true, folder_id: "carpeta", name: "Ana", suspended_at: "2026-10-18T10:00:00.000Z" }] });
    expect((await POST(await request())).status).toBe(401);
  });

  it("frena a quien denuncia una y otra vez", async () => {
    stubSupabase({ submit: [{ ok: false, reason: "too-many" }] });
    const response = await POST(await request());
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ reason: "too-many" });
  });

  it("rechaza lo que no puede ser antes de preguntar a nadie", async () => {
    const calls = stubSupabase();
    for (const [body, reason] of [
      [{ library: "general" }, "library"],
      [{ library: "Ana" }, "library"],
      [{ reason: "me-cae-mal" }, "reason"],
      [{ details: "x".repeat(1001) }, "details"],
      [{ fileId: "corto" }, "file"],
    ] as const) {
      const response = await POST(await request(body));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ reason });
    }
    expect(calls).toHaveLength(0);
  });

  it("no deja que otro sitio mande denuncias", async () => {
    const calls = stubSupabase();
    const foreign = new Request(await request(), { headers: { origin: "https://otro.example" } });
    expect((await POST(foreign)).status).toBe(403);
    expect(calls).toHaveLength(0);
  });
});

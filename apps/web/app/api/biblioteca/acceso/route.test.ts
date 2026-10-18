import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DELETE, POST } from "./route";

const redeemed = [{ code_id: "c1", expires_at: null, ok: true, reason: "ok" }];

function request(body: Record<string, unknown>) {
  return new Request("http://localhost/api/biblioteca/acceso", {
    body: JSON.stringify({ code: "OCT26", deviceId: "equipo-123", name: "Ana", ...body }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

/** Supabase de mentira: devuelve `rows` al canje y recuerda con qué se le llamó. */
function stubSupabase(rows: unknown = redeemed) {
  const fetcher = vi.fn().mockResolvedValue(Response.json(rows));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

function redeemBody(fetcher: ReturnType<typeof vi.fn>) {
  return JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://db.example");
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_x");
  vi.stubEnv("PLIEGUE_GENERAL_FOLDER_ID", "carpeta-general");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("entrar en una biblioteca", () => {
  it("sin decir cuál, entra en la general con su cookie de siempre", async () => {
    const fetcher = stubSupabase();
    const response = await POST(request({}));
    expect(response.status).toBe(200);
    expect(redeemBody(fetcher)).toMatchObject({ p_code: "OCT26", p_library: "general" });
    expect(response.headers.get("set-cookie")).toMatch(/^pliegue-biblioteca-general=[^;]+;.*HttpOnly/i);
  });

  it("en una compartida, canjea en ella y deja su propia cookie, aunque falte la carpeta de la general", async () => {
    vi.stubEnv("PLIEGUE_GENERAL_FOLDER_ID", "");
    const fetcher = stubSupabase();
    const response = await POST(request({ library: "ana-lopez" }));
    expect(response.status).toBe(200);
    expect(redeemBody(fetcher)).toMatchObject({ p_library: "ana-lopez" });
    expect(response.headers.get("set-cookie")).toMatch(/^pliegue-biblioteca-ana-lopez=/);
  });

  it("sin la carpeta de la general, la general sigue sin estar disponible", async () => {
    vi.stubEnv("PLIEGUE_GENERAL_FOLDER_ID", "");
    stubSupabase();
    const response = await POST(request({}));
    expect(response.status).toBe(503);
  });

  it("rechaza una dirección imposible o reservada sin preguntar a Supabase", async () => {
    const fetcher = stubSupabase();
    for (const library of ["leer", "Ana Lopez", 7]) {
      const response = await POST(request({ library }));
      expect(response.status).toBe(400);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("una biblioteca pausada responde que está cerrada", async () => {
    stubSupabase([{ code_id: null, expires_at: null, ok: false, reason: "closed" }]);
    const response = await POST(request({ library: "ana-lopez" }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ reason: "closed" });
  });
});

describe("salir de una biblioteca", () => {
  it("borra la cookie de la general, o la de la biblioteca que se diga", async () => {
    const general = await DELETE(new Request("http://localhost/api/biblioteca/acceso", { method: "DELETE" }));
    expect(general.headers.get("set-cookie")).toMatch(/^pliegue-biblioteca-general=;.*Max-Age=0/i);
    const shared = await DELETE(new Request("http://localhost/api/biblioteca/acceso?library=ana-lopez", { method: "DELETE" }));
    expect(shared.headers.get("set-cookie")).toMatch(/^pliegue-biblioteca-ana-lopez=;.*Max-Age=0/i);
    const wrong = await DELETE(new Request("http://localhost/api/biblioteca/acceso?library=leer", { method: "DELETE" }));
    expect(wrong.status).toBe(400);
  });

  it("no deja que otro sitio haga entrar o salir a nadie", async () => {
    const fetcher = stubSupabase();
    const foreign = { headers: { origin: "https://otro.example" } };
    expect((await POST(new Request(request({}), foreign))).status).toBe(403);
    expect((await DELETE(new Request("http://localhost/api/biblioteca/acceso", { method: "DELETE", ...foreign }))).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

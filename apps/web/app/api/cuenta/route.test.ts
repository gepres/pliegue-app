// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DELETE } from "./route";

const userId = "11111111-2222-3333-4444-555555555555";

function request(body: object | null, { origin = "http://localhost", token = "token-de-sesion" }: { origin?: string; token?: string } = {}) {
  return new Request("http://localhost/api/cuenta", {
    body: body === null ? "" : JSON.stringify(body),
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json", origin },
    method: "DELETE",
  });
}

/** Supabase de mentira: quién es la sesión y qué se pidió borrar. */
function supabase({ session = true, deleteStatus = 200 }: { deleteStatus?: number; session?: boolean } = {}) {
  const calls: { headers: Headers; method: string; url: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ headers: new Headers(init.headers), method: init.method ?? "GET", url });
      if (url.endsWith("/auth/v1/user")) {
        return session ? Response.json({ email: "lectora@example.com", id: userId }) : Response.json({ msg: "invalid JWT" }, { status: 401 });
      }
      if (url.includes("/auth/v1/admin/users/")) return new Response(deleteStatus === 200 ? "{}" : "{}", { status: deleteStatus });
      return new Response("no", { status: 500 });
    }),
  );
  return calls;
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://db.example");
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_x");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("borrar la cuenta (02.4)", () => {
  it("borra la cuenta de la sesión con la clave secreta, y solo esa", async () => {
    const calls = supabase();
    // Aunque el cuerpo nombre a otra persona, se borra a quien manda la sesión.
    const response = await DELETE(request({ confirm: "borrar-mi-cuenta", userId: "99999999-9999-9999-9999-999999999999" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    const removal = calls.find((call) => call.method === "DELETE");
    expect(removal?.url).toBe(`https://db.example/auth/v1/admin/users/${userId}`);
    expect(removal?.headers.get("apikey")).toBe("sb_secret_x");
    // Una clave secreta nueva no es un JWT: no va en Authorization.
    expect(removal?.headers.get("authorization")).toBeNull();
  });

  it("sin la confirmación explícita, desde otro origen o sin sesión, no borra nada", async () => {
    const calls = supabase();
    expect((await DELETE(request({}))).status).toBe(400);
    expect((await DELETE(request({ confirm: true }))).status).toBe(400);
    expect((await DELETE(request({ confirm: "borrar-mi-cuenta" }, { origin: "https://otro.example" }))).status).toBe(403);
    expect((await DELETE(request({ confirm: "borrar-mi-cuenta" }, { token: "" }))).status).toBe(401);
    expect(calls.some((call) => call.method === "DELETE")).toBe(false);

    supabase({ session: false });
    const expired = await DELETE(request({ confirm: "borrar-mi-cuenta" }));
    expect(expired.status).toBe(401);
    expect((await expired.json()).error).toMatch(/sesión caducó/);
  });

  it("si Supabase no puede borrarla, lo dice y no da la cuenta por borrada", async () => {
    supabase({ deleteStatus: 500 });
    const response = await DELETE(request({ confirm: "borrar-mi-cuenta" }));
    expect(response.status).toBe(503);
    expect((await response.json()).error).toMatch(/No se borró nada/);
  });

  it("sin la nube configurada, no hace nada", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    const calls = supabase();
    expect((await DELETE(request({ confirm: "borrar-mi-cuenta" }))).status).toBe(503);
    expect(calls).toHaveLength(0);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sharedLibraryTermsVersion } from "../../../library-access/shared-library-terms";
import { POST } from "./route";

const publicFolder = {
  capabilities: { canShare: true },
  mimeType: "application/vnd.google-apps.folder",
  name: "Libros",
  ownedByMe: true,
  permissions: [{ role: "reader", type: "anyone" }],
};

function request(body: Record<string, unknown> = {}, token: string | null = "token-ana") {
  return new Request("http://localhost/api/biblioteca/compartidas", {
    body: JSON.stringify({
      driveToken: "drive-token",
      folderId: "carpeta-de-ana-123",
      name: "  Los libros   de Ana ",
      slug: "ana-lopez",
      termsVersion: sharedLibraryTermsVersion,
      ...body,
    }),
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    method: "POST",
  });
}

/** Supabase y Drive de mentira: responde según la dirección y recuerda lo que se le pidió. */
function stubServices({ folder = publicFolder as unknown, insert = 201, user = { email: "ana@x", id: "u1" } as unknown } = {}) {
  const calls: Array<{ body: unknown; url: string }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ body: init?.body ? JSON.parse(String(init.body)) : null, url });
      if (url.endsWith("/auth/v1/user")) return user ? Response.json(user) : Response.json({}, { status: 401 });
      if (url.includes("/drive/v3/files/")) return Response.json(folder);
      if (url.endsWith("/rest/v1/shared_libraries")) {
        return insert === 201 ? new Response(null, { status: 201 }) : Response.json({ code: "23505", details: "Key (slug)=(ana-lopez) already exists." }, { status: insert });
      }
      return Response.json({}, { status: 404 });
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

describe("crear una biblioteca compartida", () => {
  it("con la cuenta, una carpeta suya y pública, y las normas aceptadas, la crea a su nombre", async () => {
    const calls = stubServices();
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true, slug: "ana-lopez" });
    const insert = calls.find((call) => call.url.endsWith("/rest/v1/shared_libraries"));
    expect(insert?.body).toMatchObject({ folder_id: "carpeta-de-ana-123", name: "Los libros de Ana", owner_id: "u1", slug: "ana-lopez" });
    // El token de Drive solo va a Drive: no se guarda.
    expect(JSON.stringify(insert?.body)).not.toContain("drive-token");
  });

  it("sin sesión de Pliegue no crea nada", async () => {
    const calls = stubServices({ user: null });
    expect((await POST(request({}, null))).status).toBe(401);
    expect((await POST(request({}, "caducado"))).status).toBe(401);
    expect(calls.some((call) => call.url.includes("/rest/v1/"))).toBe(false);
  });

  it("si la carpeta no es pública, lo explica y no la crea", async () => {
    const calls = stubServices({ folder: { ...publicFolder, permissions: [] } });
    const response = await POST(request());
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ reason: "not-public" });
    expect(calls.some((call) => call.url.includes("/rest/v1/"))).toBe(false);
  });

  it("rechaza lo que no puede ser antes de preguntar a nadie", async () => {
    const calls = stubServices();
    for (const [body, reason] of [
      [{ slug: "general" }, "slug"],
      [{ slug: "Ana Lopez" }, "slug"],
      [{ name: "   " }, "name"],
      [{ folderId: "corta" }, "folder"],
      [{ termsVersion: "2020-01-01" }, "terms"],
      [{ driveToken: "" }, "drive"],
    ] as const) {
      const response = await POST(request(body));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ reason });
    }
    expect(calls).toHaveLength(0);
  });

  it("si la dirección ya es de otra biblioteca, lo dice", async () => {
    stubServices({ insert: 409 });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ reason: "slug-taken" });
  });

  it("no deja que otro sitio cree bibliotecas", async () => {
    const calls = stubServices();
    const foreign = new Request(request(), { headers: { authorization: "Bearer token-ana", origin: "https://otro.example" } });
    expect((await POST(foreign)).status).toBe(403);
    expect(calls).toHaveLength(0);
  });
});

import { describe, expect, it, vi } from "vitest";

import type { LibraryBaseConfig } from "./access-server";
import { insertSharedLibrary, inspectDriveFolder, readDriveApiUrl, sessionUser, submitLibraryReport } from "./shared-library-server";

const config: LibraryBaseConfig = { secretKey: "sb_secret_x", sessionSecret: "s", supabaseUrl: "https://db.example" };
const folder = (overrides: Record<string, unknown> = {}) => ({
  capabilities: { canShare: true },
  mimeType: "application/vnd.google-apps.folder",
  name: "Libros de Ana",
  ownedByMe: true,
  permissions: [
    { role: "owner", type: "user" },
    { role: "reader", type: "anyone" },
  ],
  trashed: false,
  ...overrides,
});
const respond = (body: unknown, status = 200) => vi.fn().mockResolvedValue(Response.json(body, { status })) as unknown as typeof fetch;

describe("la cuenta que crea la biblioteca", () => {
  it("la pregunta a Supabase Auth con su token y la clave secreta", async () => {
    const fetcher = respond({ email: "ana@x", id: "u1" });
    expect(await sessionUser("token-ana", { config, fetcher })).toEqual({ email: "ana@x", id: "u1" });
    const [url, init] = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://db.example/auth/v1/user");
    expect(init.headers).toEqual({ apikey: "sb_secret_x", Authorization: "Bearer token-ana" });
  });

  it("sin token, con uno caducado o sin nube, no hay cuenta", async () => {
    expect(await sessionUser("", { config, fetcher: respond({ id: "u1" }) })).toBeNull();
    expect(await sessionUser("viejo", { config, fetcher: respond({ msg: "expired" }, 401) })).toBeNull();
    expect(await sessionUser("token", { config: null })).toBeNull();
  });
});

describe("la carpeta de Drive", () => {
  const deps = (body: unknown, status = 200) => ({ driveApiUrl: "https://drive.example/v3", fetcher: respond(body, status) });

  it("vale si es una carpeta suya y la ve cualquiera con el enlace", async () => {
    const check = deps(folder());
    expect(await inspectDriveFolder("carpeta-123", "drive-token", check)).toEqual({ name: "Libros de Ana", ok: true });
    const [url, init] = (check.fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/^https:\/\/drive\.example\/v3\/files\/carpeta-123\?fields=.*permissions/);
    expect(init.headers).toEqual({ Authorization: "Bearer drive-token" });
  });

  it("también si no es suya pero puede compartirla", async () => {
    expect((await inspectDriveFolder("c", "t", deps(folder({ ownedByMe: false })))).ok).toBe(true);
  });

  it("dice qué le falta", async () => {
    expect(await inspectDriveFolder("c", "t", deps(folder({ permissions: [{ role: "owner", type: "user" }] })))).toEqual({ ok: false, problem: "not-public" });
    expect(await inspectDriveFolder("c", "t", deps(folder({ permissions: [{ role: "reader", type: "domain" }] })))).toEqual({ ok: false, problem: "not-public" });
    expect(await inspectDriveFolder("c", "t", deps(folder({ permissions: undefined })))).toEqual({ ok: false, problem: "not-public" });
    expect(await inspectDriveFolder("c", "t", deps(folder({ capabilities: { canShare: false }, ownedByMe: false })))).toEqual({ ok: false, problem: "not-yours" });
    expect(await inspectDriveFolder("c", "t", deps(folder({ mimeType: "application/pdf" })))).toEqual({ ok: false, problem: "not-folder" });
    expect(await inspectDriveFolder("c", "t", deps(folder({ trashed: true })))).toEqual({ ok: false, problem: "not-folder" });
    expect(await inspectDriveFolder("c", "t", deps({ error: {} }, 404))).toEqual({ ok: false, problem: "drive" });
  });

  it("la API de Drive es la de Google salvo que se diga otra", () => {
    expect(readDriveApiUrl({})).toBe("https://www.googleapis.com/drive/v3");
    expect(readDriveApiUrl({ PLIEGUE_DRIVE_API_URL: "http://127.0.0.1:9/drive/v3/" })).toBe("http://127.0.0.1:9/drive/v3");
  });
});

describe("crear la biblioteca", () => {
  const library = { folderId: "carpeta-123", name: "Los libros de Ana", ownerId: "u1", slug: "ana-lopez", termsVersion: "2026-10-18" };

  it("la inserta con la clave secreta, ya comprobada y con las normas aceptadas", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 201 })) as unknown as typeof fetch;
    const now = new Date("2026-10-18T12:00:00.000Z");
    expect(await insertSharedLibrary(library, { config, fetcher }, now)).toEqual({ ok: true });
    const [url, init] = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://db.example/rest/v1/shared_libraries");
    expect(JSON.parse(String(init.body))).toEqual({
      folder_id: "carpeta-123",
      name: "Los libros de Ana",
      owner_id: "u1",
      slug: "ana-lopez",
      terms_accepted_at: now.toISOString(),
      terms_version: "2026-10-18",
      verified_at: now.toISOString(),
    });
  });

  it("distingue la dirección ocupada de la cuenta que ya tiene una", async () => {
    const conflict = (details: string) => respond({ code: "23505", details, message: "duplicate key value violates unique constraint" }, 409);
    expect(await insertSharedLibrary(library, { config, fetcher: conflict("Key (slug)=(ana-lopez) already exists.") })).toEqual({ ok: false, problem: "slug-taken" });
    expect(await insertSharedLibrary(library, { config, fetcher: conflict("Key (owner_id)=(u1) already exists.") })).toEqual({ ok: false, problem: "already-has" });
    expect(await insertSharedLibrary(library, { config, fetcher: respond({}, 500) })).toEqual({ ok: false, problem: "unavailable" });
  });
});

describe("mandar una denuncia", () => {
  const report = {
    clientHash: "huella",
    codeId: "c9",
    details: "Libros con derechos",
    deviceId: "equipo-1",
    fileId: null,
    library: "ana-lopez",
    reason: "derechos",
    visitorName: "Marta",
  };

  it("llama a la base con la clave secreta y dice cómo fue", async () => {
    const fetcher = respond([{ ok: true, reason: "ok" }]);
    expect(await submitLibraryReport(report, { config, fetcher })).toBe("ok");
    const [url, init] = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://db.example/rest/v1/rpc/submit_library_report");
    expect(JSON.parse(String(init.body))).toMatchObject({ p_code_id: "c9", p_library: "ana-lopez", p_visitor_name: "Marta" });
    expect(await submitLibraryReport(report, { config, fetcher: respond([{ ok: false, reason: "too-many" }]) })).toBe("too-many");
    expect(await submitLibraryReport(report, { config, fetcher: respond([{ ok: false, reason: "invalid" }]) })).toBe("invalid");
    expect(await submitLibraryReport(report, { config, fetcher: respond({}, 500) })).toBe("unavailable");
    expect(await submitLibraryReport(report, { config: null })).toBe("unavailable");
  });
});

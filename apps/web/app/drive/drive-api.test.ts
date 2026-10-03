import { describe, expect, it } from "vitest";

import {
  DriveApiError,
  downloadDriveFile,
  driveRequest,
  listDriveChildren,
  walkDriveFolder,
} from "./drive-api";
import {
  driveContentUrl,
  driveDocumentFormat,
  driveFileName,
  driveFolderMimeType,
  googleDocMimeType,
  isReadableDriveFile,
  type DriveFileMeta,
} from "./drive-files";

const noRetry = { retryDelaysMs: [] };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, status });
}

/** Un Drive en memoria: carpetas por id, con sus hijos, paginados de dos en dos. */
function fakeDrive(tree: Record<string, DriveFileMeta[]>) {
  const calls: string[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(url.pathname + url.search);
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer token");
    const folderId = /'([^']+)' in parents/.exec(url.searchParams.get("q") ?? "")?.[1] ?? "";
    const children = tree[folderId] ?? [];
    const start = Number(url.searchParams.get("pageToken") ?? 0);
    return json({
      files: children.slice(start, start + 2),
      nextPageToken: start + 2 < children.length ? String(start + 2) : undefined,
    });
  }) as typeof fetch;
  return { calls, fetcher };
}

const pdf = (id: string, name: string): DriveFileMeta => ({ id, mimeType: "application/pdf", name, size: "1024" });
const folder = (id: string, name: string): DriveFileMeta => ({ id, mimeType: driveFolderMimeType, name });

describe("archivos de Drive", () => {
  it("decide el formato por la extensión y exporta los Documentos de Google a DOCX", () => {
    expect(driveDocumentFormat({ mimeType: "application/pdf", name: "Libro.PDF" })).toBe("pdf");
    expect(driveDocumentFormat({ mimeType: googleDocMimeType, name: "Notas" })).toBe("docx");
    expect(driveDocumentFormat({ mimeType: "application/vnd.google-apps.spreadsheet", name: "Hoja" })).toBeNull();
    expect(driveFileName({ mimeType: googleDocMimeType, name: "Notas" })).toBe("Notas.docx");
    expect(driveContentUrl({ id: "a b", mimeType: googleDocMimeType })).toContain("/files/a%20b/export?mimeType=");
    expect(driveContentUrl({ id: "x", mimeType: "application/pdf" })).toContain("/files/x?alt=media");
  });

  it("descarta carpetas, papelera, vacíos y formatos desconocidos", () => {
    expect(isReadableDriveFile(pdf("1", "a.pdf"))).toBe(true);
    expect(isReadableDriveFile({ ...pdf("1", "a.pdf"), trashed: true })).toBe(false);
    expect(isReadableDriveFile({ ...pdf("1", "a.pdf"), size: "0" })).toBe(false);
    expect(isReadableDriveFile(pdf("1", "a.rar"))).toBe(false);
    expect(isReadableDriveFile({ id: "g", mimeType: googleDocMimeType, name: "Notas" })).toBe(true);
    expect(isReadableDriveFile(folder("f", "Carpeta"))).toBe(false);
  });
});

describe("cliente de Drive", () => {
  it("clasifica los errores que la interfaz debe distinguir", async () => {
    const cases: Array<[Response, string]> = [
      [json({ error: { message: "x" } }, 401), "auth"],
      [json({ error: { errors: [{ reason: "insufficientPermissions" }] } }, 403), "scope"],
      [json({ error: { errors: [{ reason: "appNotAuthorizedToFile" }] } }, 403), "scope"],
      [json({ error: { errors: [{ reason: "notFound" }] } }, 404), "not-found"],
      [json({ error: { errors: [{ reason: "userRateLimitExceeded" }] } }, 403), "rate"],
      [new Response("boom", { status: 503 }), "server"],
    ];
    for (const [response, kind] of cases) {
      const error = await driveRequest("https://drive.test/x", "token", {
        ...noRetry,
        fetcher: (async () => response.clone()) as typeof fetch,
      }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(DriveApiError);
      expect((error as DriveApiError).kind).toBe(kind);
    }
  });

  it("reintenta lo pasajero y se rinde con lo demás", async () => {
    let attempts = 0;
    const flaky = (async () => {
      attempts += 1;
      return attempts < 3 ? new Response("", { status: 503 }) : json({ ok: true });
    }) as typeof fetch;
    const response = await driveRequest("https://drive.test/x", "token", { fetcher: flaky, retryDelaysMs: [0, 0, 0] });
    expect(await response.json()).toEqual({ ok: true });
    expect(attempts).toBe(3);

    attempts = 0;
    const denied = (async () => {
      attempts += 1;
      return json({}, 401);
    }) as typeof fetch;
    await expect(driveRequest("https://drive.test/x", "token", { fetcher: denied, retryDelaysMs: [0, 0] })).rejects.toMatchObject({
      kind: "auth",
    });
    expect(attempts).toBe(1);
  });

  it("recorre todas las páginas de una carpeta", async () => {
    const { calls, fetcher } = fakeDrive({ raiz: [pdf("1", "a.pdf"), pdf("2", "b.pdf"), pdf("3", "c.pdf")] });
    const children = await listDriveChildren("raiz", "token", { ...noRetry, fetcher });
    expect(children.map((child) => child.id)).toEqual(["1", "2", "3"]);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("supportsAllDrives=true");
    expect(calls[0]).toContain("includeItemsFromAllDrives=true");
  });

  it("recorre subcarpetas con rutas relativas y visita cada carpeta una vez", async () => {
    const { fetcher } = fakeDrive({
      filo: [pdf("3", "Kant.pdf"), folder("raiz", "Libros")],
      raiz: [pdf("1", "Actos humanos.pdf"), folder("filo", "FILOSOFÍA"), folder("vacia", "Vacía")],
    });
    const walk = await walkDriveFolder("raiz", "token", { ...noRetry, fetcher });
    expect(walk.files.map((file) => file.relativePath)).toEqual(["Actos humanos.pdf", "FILOSOFÍA/Kant.pdf"]);
    expect(walk.folders).toBe(3);
  });

  it("para al pasar del límite de archivos", async () => {
    const { fetcher } = fakeDrive({ raiz: [pdf("1", "a.pdf"), pdf("2", "b.pdf"), pdf("3", "c.pdf")] });
    await expect(walkDriveFolder("raiz", "token", { ...noRetry, fetcher, limit: 2 })).rejects.toThrow("límite");
  });

  it("descarga con avance", async () => {
    const bytes = new Uint8Array(10_000).fill(7);
    const fetcher = (async () =>
      new Response(bytes, { headers: { "content-length": "10000", "content-type": "application/pdf" } })) as typeof fetch;
    const progress: number[] = [];
    const blob = await downloadDriveFile({ id: "1", mimeType: "application/pdf" }, "token", {
      ...noRetry,
      fetcher,
      onProgress: (loaded, total) => {
        expect(total).toBe(10_000);
        progress.push(loaded);
      },
    });
    expect(blob.size).toBe(10_000);
    expect(blob.type).toBe("application/pdf");
    expect(progress.at(-1)).toBe(10_000);
  });
});

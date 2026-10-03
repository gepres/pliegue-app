import { describe, expect, it } from "vitest";

import { downloadDriveFile, listDriveChildren } from "../drive/drive-api";
import type { DriveListedFile } from "../drive/drive-files";
import { catalogImportJsonSchema } from "./catalog-template";
import { filterDocuments, organizationFacets } from "./documents";
import { buildGeneralLibrary, findCatalogFile, generalDocumentId, generalReaderHref } from "./general-library";

function file(id: string, relativePath: string, size = 1000, modifiedTime = "2026-09-01T10:00:00.000Z"): DriveListedFile {
  const name = relativePath.split("/").at(-1) ?? relativePath;
  return { id, mimeType: name.endsWith(".json") ? "application/json" : "application/pdf", modifiedTime, name, relativePath, size: String(size) };
}

const files = [
  file("a", "Historia del Perú/TOMO-VIII-HP-Basadre.pdf"),
  file("b", "Literatura/Ficciones.pdf"),
  file("c", "Literatura/Ficciones (copia).pdf"),
  file("d", "suelto.pdf"),
  file("e", "notas.exe"),
  file("cat-old", "pliegue-catalogo-v2-2026-09-30.json", 10, "2026-09-30T00:00:00.000Z"),
  file("cat-new", "pliegue-catalogo-v2-2026-10-02.json", 10, "2026-10-02T00:00:00.000Z"),
];

const catalog = {
  $schema: catalogImportJsonSchema,
  entries: [
    {
      authors: ["Jorge Basadre Grohmann"],
      category: "Historia",
      cover: { height: 3, source: "pdf-page", src: "data:image/webp;base64,AAAA", width: 2 },
      fileName: "TOMO-VIII-HP-Basadre.pdf",
      relativePath: "Historia del Perú/TOMO-VIII-HP-Basadre.pdf",
      subcategory: "Historia del Perú",
      title: "Historia de la República del Perú. Tomo 8",
      workType: "book",
    },
    {
      authors: ["Jorge Luis Borges"],
      category: "Literatura",
      fileName: "Ficciones.pdf",
      relativePath: "Literatura/Ficciones.pdf",
      title: "Ficciones",
      workType: "book",
    },
    {
      authors: ["Jorge Luis Borges"],
      category: "Literatura",
      duplicateOf: "Literatura/Ficciones.pdf",
      fileName: "Ficciones (copia).pdf",
      relativePath: "Literatura/Ficciones (copia).pdf",
      title: "Ficciones",
      workType: "book",
    },
  ],
};

const noFilters = { availability: "all", favoriteIds: new Set<string>(), favoritesOnly: false, format: "all", origin: "all", query: "" } as const;

describe("biblioteca general", () => {
  it("convierte la carpeta en documentos con su propio identificador, sin el índice ni lo ilegible", () => {
    const library = buildGeneralLibrary(files, null, "2026-10-03T00:00:00.000Z");
    expect(library.documents.map((document) => [document.id, document.relativePath])).toEqual([
      ["general:a", "Historia del Perú/TOMO-VIII-HP-Basadre.pdf"],
      ["general:b", "Literatura/Ficciones.pdf"],
      ["general:c", "Literatura/Ficciones (copia).pdf"],
      ["general:d", "suelto.pdf"],
    ]);
    expect(generalDocumentId("a")).toBe("general:a");
    expect(generalReaderHref("a b")).toBe("/biblioteca/general/leer?libro=a%20b");
    expect(generalReaderHref("a", true)).toBe("/biblioteca/general/leer?libro=a&resume=1");
  });

  it("con el índice JSON trae ficha, portada y categoría, y marca las copias repetidas", () => {
    const library = buildGeneralLibrary(files, catalog, "2026-10-03T00:00:00.000Z");
    expect(library.catalogued).toBe(3);
    expect(library.duplicates).toBe(1);
    const basadre = library.documents.find((document) => document.id === "general:a");
    expect(basadre?.catalog?.canonicalTitle).toBe("Historia de la República del Perú. Tomo 8");
    expect(basadre?.catalog?.authors).toEqual(["Jorge Basadre Grohmann"]);
    expect(basadre?.cover?.src).toBe("data:image/webp;base64,AAAA");
    expect(basadre?.organization).toMatchObject({ category: "Historia", subcategory: "Historia del Perú" });
    expect(organizationFacets(library.documents).categories.map((item) => item.value)).toEqual(["Literatura", "Historia"]);
  });

  it("se filtra con las mismas reglas que la biblioteca personal", () => {
    const { documents } = buildGeneralLibrary(files, catalog, "2026-10-03T00:00:00.000Z");
    const ids = (filters: Partial<Parameters<typeof filterDocuments>[1]>) =>
      filterDocuments(documents, { ...noFilters, ...filters }).map((document) => document.id);
    expect(ids({ query: "republica del peru" })).toEqual(["general:a"]);
    expect(ids({ query: "BASADRE" })).toEqual(["general:a"]);
    expect(ids({ category: "Literatura", hideDuplicates: true })).toEqual(["general:b"]);
    expect(ids({ hideDuplicates: true })).toHaveLength(3);
  });

  it("un índice roto no deja la biblioteca vacía", () => {
    expect(buildGeneralLibrary(files, { cualquier: "cosa" }, "2026-10-03T00:00:00.000Z").documents).toHaveLength(4);
  });

  it("elige el índice más reciente de la carpeta", () => {
    expect(findCatalogFile(files)?.id).toBe("cat-new");
    expect(findCatalogFile(files.slice(0, 3))).toBeNull();
  });
});

describe("Drive con la clave de API", () => {
  it("lleva la clave en la URL y no manda cabecera de autorización", async () => {
    const calls: Array<{ headers: HeadersInit | undefined; url: string }> = [];
    const fetcher = (async (url: string, init?: RequestInit) => {
      calls.push({ headers: init?.headers, url });
      return url.includes("alt=media")
        ? new Response("%PDF-1.7", { headers: { "content-type": "application/pdf" } })
        : Response.json({ files: [{ id: "a", mimeType: "application/pdf", name: "a.pdf" }] });
    }) as typeof fetch;
    const children = await listDriveChildren("carpeta", { apiKey: "clave-publica" }, { fetcher });
    expect(children).toHaveLength(1);
    expect(new URL(calls[0]?.url ?? "").searchParams.get("key")).toBe("clave-publica");
    expect(calls[0]?.headers).toEqual({});

    const blob = await downloadDriveFile({ id: "a", mimeType: "application/pdf" }, { apiKey: "clave-publica" }, { fetcher });
    expect(await blob.text()).toBe("%PDF-1.7");
    expect(new URL(calls[1]?.url ?? "").searchParams.get("key")).toBe("clave-publica");
  });
});

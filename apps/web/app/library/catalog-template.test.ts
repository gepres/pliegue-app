import { describe, expect, it } from "vitest";

import {
  applyImportedCatalogs,
  createImportedCatalogRecords,
  parseCatalogImportFile,
} from "./catalog-import";
import {
  catalogExampleFileName,
  catalogTemplateFileName,
  catalogTemplateInstructions,
  createCatalogExample,
  createCatalogTemplate,
  serializeCatalogTemplate,
} from "./catalog-template";
import type { LibraryDocument } from "./documents";

const exampleCover =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAeCAMAAAAbzM5ZAAAACVBMVEU2W0j79uzJkjKQtiJmAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAGklEQVR42mNgGGjAiALwCRIPmOCAYRQMQgAAV3AAMUOOf+kAAAAASUVORK5CYII=";

const document = {
  author: "Archivo original vinculado",
  availability: "available",
  catalog: {
    authors: ["Marco Aurelio"],
    canonicalTitle: "Meditaciones",
    confidence: 0.8,
    genres: ["Filosofía"],
    language: "español",
    publicationYear: 1998,
    summary: "Anotaciones personales del emperador.",
    topics: ["estoicismo"],
    workType: "book",
  },
  fingerprint: "meditaciones.pdf::2048::1700000000000",
  format: "pdf",
  id: "document-1",
  meta: "2 KB · Referencia local · Sin copia",
  origin: "local",
  originalName: "Meditaciones.pdf",
  reference: { kind: "local-file", referenceId: "document-1" },
  tags: [],
  title: "Meditaciones",
} as unknown as LibraryDocument;

const pendingDocument = {
  author: "Archivo original vinculado",
  availability: "available",
  fingerprint: "sin-ficha.pdf::100::1700000000001",
  format: "pdf",
  id: "document-2",
  meta: "100 B · Referencia local · Sin copia",
  origin: "local",
  originalName: "sin-ficha.pdf",
  reference: { kind: "local-file", referenceId: "document-2" },
  tags: [],
  title: "sin ficha",
} as unknown as LibraryDocument;

describe("plantilla de catálogo", () => {
  it("prellena la entrada con la ficha que el documento ya tiene", () => {
    const [entry] = createCatalogTemplate([document]).entries;

    expect(entry).toMatchObject({
      authors: ["Marco Aurelio"],
      fileName: "Meditaciones.pdf",
      fingerprint: "meditaciones.pdf::2048::1700000000000",
      publicationYear: 1998,
      title: "Meditaciones",
      workType: "book",
    });
  });

  it("deja los campos sin ficha visibles y vacíos en lugar de omitirlos", () => {
    const [entry] = createCatalogTemplate([pendingDocument]).entries;

    expect(entry).toMatchObject({
      authors: [],
      isbn: null,
      publicationYear: null,
      summary: null,
      workType: "other",
    });
    expect(Object.keys(entry ?? {})).toContain("publisher");
  });

  it("lleva dentro el esquema y las instrucciones para rellenarlo", () => {
    const template = createCatalogTemplate([document]);

    expect(template.pliegueCatalog).toBe(2);
    expect(template.instructions).toEqual(catalogTemplateInstructions);
    expect(template.$schema.properties.entries.items.required).toContain("fileName");
  });

  it("vuelve a importarse sin perder lo que ya estaba catalogado", () => {
    const template = createCatalogTemplate([document]);
    const parsed = parseCatalogImportFile(JSON.parse(serializeCatalogTemplate(template)));
    const [applied] = applyImportedCatalogs([document], createImportedCatalogRecords(parsed));

    expect(parsed.dialect).toBe("pliegue");
    expect(parsed.issues).toHaveLength(0);
    expect(applied?.catalog).toMatchObject({
      authors: ["Marco Aurelio"],
      canonicalTitle: "Meditaciones",
      genres: ["Filosofía"],
      language: "es",
      publicationYear: 1998,
      topics: ["estoicismo"],
      workType: "book",
    });
  });

  it("conserva al exportar e importar los datos bibliográficos, la organización y la portada", () => {
    // Antes la editorial, la serie o el ISBN se guardaban al importar pero no llegaban al
    // documento, y la plantilla siguiente salía sin ellos.
    const enriched = {
      ...document,
      bibliographic: {
        doi: null,
        edition: null,
        editors: ["Héctor López Martínez"],
        isbn: "9786123063610",
        originalTitle: null,
        pageCount: 303,
        publisher: "Gredos",
        rights: null,
        series: "Biblioteca Clásica",
        translators: ["Ramón Bach"],
        url: null,
        volume: 8,
      },
      cover: { height: 30, source: "pdf-page", src: exampleCover, width: 20 },
      organization: { category: "Filosofía", duplicateOf: null, subcategory: "Estoicismo" },
    } as LibraryDocument;

    const template = createCatalogTemplate([enriched]);
    const parsed = parseCatalogImportFile(JSON.parse(serializeCatalogTemplate(template)));
    const [applied] = applyImportedCatalogs([document], createImportedCatalogRecords(parsed));

    expect(applied?.bibliographic).toMatchObject({
      editors: ["Héctor López Martínez"],
      isbn: "9786123063610",
      pageCount: 303,
      publisher: "Gredos",
      series: "Biblioteca Clásica",
      translators: ["Ramón Bach"],
      volume: 8,
    });
    expect(applied?.organization).toEqual({
      category: "Filosofía",
      duplicateOf: null,
      subcategory: "Estoicismo",
    });
    expect(applied?.cover).toEqual({ height: 30, source: "pdf-page", src: exampleCover, width: 20 });
  });

  it("ofrece un ejemplo documentado que se importa sin avisos", () => {
    const example = createCatalogExample("2026-09-25T00:00:00.000Z");
    const parsed = parseCatalogImportFile(JSON.parse(JSON.stringify(example)));

    expect(catalogExampleFileName).toBe("pliegue-catalogo-ejemplo.json");
    expect(parsed.dialect).toBe("pliegue");
    expect(parsed.issues).toHaveLength(0);
    expect(parsed.entries).toHaveLength(3);
    expect(parsed.entries[0]).toMatchObject({
      bibliographic: { series: "Historia de la República del Perú", volume: 8 },
      organization: { category: "Historia", subcategory: "Historia del Perú" },
    });
    expect(parsed.entries[0]?.cover?.src).toMatch(/^data:image\/png;base64,/);
    expect(parsed.entries[1]?.organization.duplicateOf).toBe(
      "Una trenza de hierba sagrada - Robin Wall Kimmerer.pdf",
    );
  });

  it("nombra el archivo con la fecha local de generación, también de noche", () => {
    expect(catalogTemplateFileName(new Date(2026, 7, 12, 23, 30))).toBe(
      "pliegue-catalogo-2026-08-12.json",
    );
  });

  it("termina el archivo con un salto de línea", () => {
    expect(serializeCatalogTemplate(createCatalogTemplate([]))).toMatch(/\}\n$/);
  });
});

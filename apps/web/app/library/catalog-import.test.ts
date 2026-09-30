import { describe, expect, it } from "vitest";

import {
  applyImportedCatalogs,
  catalogMatchKeys,
  createImportedCatalogRecords,
  describeRejectedCover,
  detectCatalogDialect,
  documentMatchKeys,
  matchImportedCatalogs,
  parseCatalogImportFile,
  readCover,
  readPublicationYear,
  readVolume,
} from "./catalog-import";
import type { LibraryDocument } from "./documents";

const linkedDocument = {
  author: "Archivo original vinculado",
  availability: "available",
  fingerprint: "meditaciones.pdf::2048::1700000000000",
  format: "pdf",
  id: "document-1",
  linked: true,
  meta: "2 KB · Referencia local · Sin copia",
  origin: "local",
  originalName: "Meditaciones.pdf",
  reference: { kind: "local-file", referenceId: "document-1" },
  tags: ["meditaciones"],
  title: "Meditaciones",
} as unknown as LibraryDocument;

const folderDocument = {
  author: "Carpeta vinculada · Libros",
  availability: "available",
  format: "epub",
  id: "document-2",
  meta: "Ensayos/lectura.epub · 2 MB",
  origin: "local",
  reference: { kind: "local-folder", relativePath: "Ensayos/lectura.epub", sourceId: "source-1" },
  tags: ["lectura"],
  title: "lectura",
} as LibraryDocument;

describe("detección de dialecto", () => {
  it("reconoce la plantilla propia por su marca de versión", () => {
    expect(detectCatalogDialect({ entries: [], pliegueCatalog: 1 })).toBe("pliegue");
  });

  it("reconoce CSL-JSON por el tipo y el título de la primera entrada", () => {
    expect(detectCatalogDialect([{ id: "abc", title: "Meditaciones", type: "book" }])).toBe(
      "csl-json",
    );
  });

  it("reconoce schema.org por el contexto JSON-LD", () => {
    expect(detectCatalogDialect({ "@context": "https://schema.org", "@type": "Book" })).toBe(
      "schema-org",
    );
  });

  it("reconoce Dublin Core por el prefijo de sus términos", () => {
    expect(detectCatalogDialect([{ "dc:creator": "Marco Aurelio", "dc:title": "Meditaciones" }])).toBe(
      "dublin-core",
    );
  });

  it("rechaza un JSON que no es ninguno de los formatos admitidos", () => {
    expect(() => parseCatalogImportFile({ cualquier: "cosa" })).toThrowError(/no se reconoce/i);
  });
});

describe("lectura del año de publicación", () => {
  it("acepta el objeto CSL con date-parts", () => {
    expect(readPublicationYear({ "date-parts": [[1998, 4, 2]] })).toBe(1998);
  });

  it("acepta una fecha ISO de schema.org", () => {
    expect(readPublicationYear("2021-05-03")).toBe(2021);
  });

  it("extrae el año de un texto libre de Dublin Core", () => {
    expect(readPublicationYear("c. 1987, reimpresión")).toBe(1987);
  });

  it("descarta un año fuera del rango del contrato", () => {
    expect(readPublicationYear(842)).toBeNull();
  });
});

describe("importación CSL-JSON", () => {
  const result = parseCatalogImportFile([
    {
      ISBN: "978-84-376-0494-7",
      abstract: "Anotaciones personales del emperador.",
      author: [{ family: "Aurelio", given: "Marco" }, { literal: "Anónimo" }],
      "call-number": "Meditaciones.pdf",
      id: "aurelio1998",
      issued: { "date-parts": [[1998]] },
      keyword: "estoicismo, ética",
      language: "español",
      "number-of-pages": 240,
      publisher: "Gredos",
      title: "Meditaciones",
      translator: [{ family: "Bach", given: "Ramón" }],
      type: "book",
    },
  ]);

  it("mapea nombres, fecha y palabras clave del estándar", () => {
    expect(result.dialect).toBe("csl-json");
    expect(result.entries[0]?.catalog).toMatchObject({
      authors: ["Marco Aurelio", "Anónimo"],
      canonicalTitle: "Meditaciones",
      // El idioma se guarda como código: «español», «es» y «es-ES» son la misma opción.
      language: "es",
      publicationYear: 1998,
      topics: ["estoicismo", "ética"],
      workType: "book",
    });
  });

  it("conserva los datos bibliográficos que la ficha de IA no modela", () => {
    expect(result.entries[0]?.bibliographic).toMatchObject({
      isbn: "978-84-376-0494-7",
      pageCount: 240,
      publisher: "Gredos",
      translators: ["Ramón Bach"],
    });
  });

  it("traduce un capítulo al tipo de obra más cercano de Pliegue", () => {
    const chapter = parseCatalogImportFile([
      { "call-number": "capitulo.pdf", title: "Capítulo", type: "chapter" },
    ]);
    expect(chapter.entries[0]?.catalog.workType).toBe("book");
  });
});

describe("importación Dublin Core y schema.org", () => {
  it("lee los términos con prefijo y parte los temas de un solo campo", () => {
    const result = parseCatalogImportFile([
      {
        "dc:creator": "Ana Pérez",
        "dc:date": "2021",
        "dc:language": "español",
        "dc:source": "practicas.epub",
        "dc:subject": "Lectura; Educación",
        "dc:title": "Prácticas de lectura",
        "dc:type": "Text",
      },
    ]);

    expect(result.dialect).toBe("dublin-core");
    expect(result.entries[0]?.catalog).toMatchObject({
      authors: ["Ana Pérez"],
      canonicalTitle: "Prácticas de lectura",
      publicationYear: 2021,
      topics: ["Lectura", "Educación"],
    });
  });

  it("lee un Book de schema.org con autor como objeto Person", () => {
    const result = parseCatalogImportFile({
      "@context": "https://schema.org",
      "@type": "Book",
      author: { "@type": "Person", name: "Ryan Holiday" },
      datePublished: "2016-05-10",
      fileName: "ego.pdf",
      inLanguage: "inglés",
      isbn: "9781591847816",
      name: "Ego Is the Enemy",
      numberOfPages: 256,
      publisher: { "@type": "Organization", name: "Portfolio" },
    });

    expect(result.dialect).toBe("schema-org");
    expect(result.entries[0]?.catalog).toMatchObject({
      authors: ["Ryan Holiday"],
      canonicalTitle: "Ego Is the Enemy",
      publicationYear: 2016,
      workType: "book",
    });
    expect(result.entries[0]?.bibliographic.publisher).toBe("Portfolio");
  });
});

describe("entradas que no pueden aplicarse", () => {
  it("explica por qué se descarta una ficha sin nombre de archivo", () => {
    const result = parseCatalogImportFile({
      entries: [{ authors: ["Sin archivo"], title: "Huérfana" }],
      pliegueCatalog: 1,
    });

    expect(result.entries).toHaveLength(0);
    expect(result.issues[0]).toMatchObject({ position: 1, title: "Huérfana" });
    expect(result.issues[0]?.reason).toMatch(/nombre del archivo/i);
  });

  it("no aborta el archivo completo cuando una entrada es ilegible", () => {
    const result = parseCatalogImportFile({
      entries: [{ fileName: "valida.pdf", title: "Válida" }, "texto suelto"],
      pliegueCatalog: 1,
    });

    expect(result.entries).toHaveLength(1);
    expect(result.issues).toHaveLength(1);
  });
});

describe("emparejamiento con la biblioteca", () => {
  it("ordena las claves de la más fuerte a la más débil y les quita los acentos", () => {
    expect(
      catalogMatchKeys({
        fileName: "Meditaciones.pdf",
        fingerprint: "meditaciones.pdf::2048::1700000000000",
        lastModified: null,
        relativePath: "Filosofía/Meditaciones.pdf",
        sizeBytes: null,
      }),
    ).toEqual([
      "fingerprint:meditaciones.pdf::2048::1700000000000",
      "path:filosofia/meditaciones.pdf",
      "name:meditaciones.pdf",
    ]);
  });

  it("compone el fingerprint a partir de tamaño y fecha cuando no viene dado", () => {
    expect(
      catalogMatchKeys({
        fileName: "Meditaciones.pdf",
        fingerprint: null,
        lastModified: 1_700_000_000_000,
        relativePath: null,
        sizeBytes: 2048,
      })[0],
    ).toBe("fingerprint:meditaciones.pdf::2048::1700000000000");
  });

  it("empareja un archivo cuyo nombre trae espacios dobles", () => {
    // La lectura de la ficha colapsa los espacios, así que la clave debe hacerlo también:
    // de lo contrario «Morey, Miguel -  Foucault.pdf» nunca reencuentra su documento.
    const conEspacioDoble = {
      ...folderDocument,
      reference: {
        kind: "local-folder" as const,
        relativePath: "coleccion/27. Morey, Miguel -  Foucault.pdf",
        sourceId: "source-1",
      },
    };
    const parsed = parseCatalogImportFile({
      entries: [{ fileName: "27. Morey, Miguel -  Foucault.pdf", title: "Foucault" }],
      pliegueCatalog: 1,
    });
    const [applied] = applyImportedCatalogs(
      [conEspacioDoble],
      createImportedCatalogRecords(parsed),
    );

    expect(applied?.catalog?.canonicalTitle).toBe("Foucault");
  });

  it("expone la ruta relativa de un documento en carpeta vinculada", () => {
    expect(documentMatchKeys(folderDocument)).toContain("path:ensayos/lectura.epub");
  });

  it("aplica la ficha al documento que coincide por nombre", () => {
    const parsed = parseCatalogImportFile({
      entries: [{ authors: ["Marco Aurelio"], fileName: "Meditaciones.pdf", workType: "book" }],
      pliegueCatalog: 1,
    });
    const [applied] = applyImportedCatalogs([linkedDocument], createImportedCatalogRecords(parsed));

    expect(applied?.catalog?.authors).toEqual(["Marco Aurelio"]);
    expect(applied?.catalogSource).toBe("import");
    expect(applied?.catalogStatus).toBe("analyzed");
  });

  it("deja en espera la ficha cuyo archivo todavía no está vinculado", () => {
    const parsed = parseCatalogImportFile({
      entries: [{ fileName: "pendiente.pdf", title: "Aún no vinculado" }],
      pliegueCatalog: 1,
    });
    const { byDocumentId, pending } = matchImportedCatalogs(
      [linkedDocument],
      createImportedCatalogRecords(parsed),
    );

    expect(byDocumentId.size).toBe(0);
    expect(pending).toHaveLength(1);
  });

  it("aplica sola la ficha en espera cuando el archivo aparece después", () => {
    const parsed = parseCatalogImportFile({
      entries: [{ fileName: "Meditaciones.pdf", title: "Meditaciones" }],
      pliegueCatalog: 1,
    });
    const records = createImportedCatalogRecords(parsed);

    expect(matchImportedCatalogs([], records).pending).toHaveLength(1);
    expect(matchImportedCatalogs([linkedDocument], records).byDocumentId.size).toBe(1);
  });

  it("la ficha escrita a mano pisa a la deducida por el modelo", () => {
    const withAiCatalog: LibraryDocument = {
      ...linkedDocument,
      catalog: {
        authors: ["Autor inferido"],
        canonicalTitle: "Título inferido",
        confidence: 0.4,
        genres: [],
        language: null,
        publicationYear: null,
        summary: null,
        topics: [],
        workType: "other",
      },
      catalogError: "El proveedor no devolvió una ficha.",
      catalogSource: "ai",
    };
    const parsed = parseCatalogImportFile({
      entries: [{ authors: ["Marco Aurelio"], fileName: "Meditaciones.pdf" }],
      pliegueCatalog: 1,
    });
    const [applied] = applyImportedCatalogs([withAiCatalog], createImportedCatalogRecords(parsed));

    expect(applied?.catalog?.authors).toEqual(["Marco Aurelio"]);
    expect(applied?.catalogError).toBeUndefined();
  });

  it("una ficha escrita a mano entra con confianza plena", () => {
    const parsed = parseCatalogImportFile({
      entries: [{ fileName: "Meditaciones.pdf", title: "Meditaciones" }],
      pliegueCatalog: 1,
    });

    expect(parsed.entries[0]?.catalog.confidence).toBe(1);
  });

  it("consolida dos entradas del mismo archivo conservando la última", () => {
    const parsed = parseCatalogImportFile({
      entries: [
        { fileName: "Meditaciones.pdf", title: "Primera" },
        { fileName: "Meditaciones.pdf", title: "Corregida" },
      ],
      pliegueCatalog: 1,
    });
    const records = createImportedCatalogRecords(parsed);

    expect(records).toHaveLength(1);
    expect(records[0]?.catalog.canonicalTitle).toBe("Corregida");
  });
});

describe("contrato 2: organización, tomo y portada", () => {
  const cover =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAeCAMAAAAbzM5ZAAAACVBMVEU2W0j79uzJkjKQtiJmAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAGklEQVR42mNgGGjAiALwCRIPmOCAYRQMQgAAV3AAMUOOf+kAAAAASUVORK5CYII=";

  it("lee categoría, subcategoría, duplicado, tomo, editores y portada", () => {
    const parsed = parseCatalogImportFile({
      entries: [
        {
          category: "Historia",
          cover: { height: 30, source: "pdf-page", src: cover, width: 20 },
          duplicateOf: "Historia/TOMO-I.pdf",
          editors: ["Héctor López Martínez"],
          fileName: "TOMO-XVIII-HP-Basadre.pdf",
          language: "Español",
          series: "Historia de la República del Perú",
          subcategory: "Historia del Perú",
          title: "Historia de la República del Perú [1933-2000]",
          volume: "Tomo XVIII",
        },
      ],
      pliegueCatalog: 2,
    });
    const [entry] = parsed.entries;

    expect(parsed.issues).toHaveLength(0);
    expect(entry?.organization).toEqual({
      category: "Historia",
      duplicateOf: "Historia/TOMO-I.pdf",
      subcategory: "Historia del Perú",
    });
    expect(entry?.bibliographic).toMatchObject({ editors: ["Héctor López Martínez"], volume: 18 });
    expect(entry?.catalog.language).toBe("es");
    expect(entry?.cover).toEqual({ height: 30, source: "pdf-page", src: cover, width: 20 });
  });

  it("solo acepta portadas incrustadas y de tamaño razonable", () => {
    expect(readCover(cover)).toMatchObject({ source: "other", src: cover });
    // Una URL obligaría a pedir la imagen a internet cada vez que se abre la Biblioteca.
    expect(readCover("https://covers.openlibrary.org/b/id/1-L.jpg")).toBeNull();
    expect(readCover({ src: "data:text/html;base64,PGgxPg==" })).toBeNull();
    expect(readCover({ src: `data:image/webp;base64,${"A".repeat(400_001)}` })).toBeNull();
  });

  it("importa la ficha sin la portada inválida y explica por qué", () => {
    const result = parseCatalogImportFile({
      entries: [
        { cover: "https://covers.openlibrary.org/b/id/1-L.jpg", fileName: "remota.pdf", title: "Remota" },
        { cover: { src: `data:image/webp;base64,${"A".repeat(400_001)}` }, fileName: "enorme.pdf", title: "Enorme" },
        { cover, fileName: "buena.pdf", title: "Buena" },
        { fileName: "sin-portada.pdf", title: "Sin portada" },
      ],
      pliegueCatalog: 2,
    });

    expect(result.entries.map((entry) => entry.cover !== null)).toEqual([false, false, true, false]);
    expect(result.issues).toEqual([]);
    expect(result.warnings.map(({ position, title }) => [position, title])).toEqual([
      [1, "Remota"],
      [2, "Enorme"],
    ]);
    expect(result.warnings[0]?.reason).toMatch(/es una URL/);
    expect(result.warnings[1]?.reason).toMatch(/el tope es 400.000/);
    expect(describeRejectedCover({ src: "data:text/html;base64,PGgxPg==" })).toMatch(/no es una imagen/);
  });

  it("entiende el tomo como número, como texto o en números romanos", () => {
    expect(readVolume(9)).toBe(9);
    expect(readVolume("Tomo 12")).toBe(12);
    expect(readVolume("IX")).toBe(9);
    expect(readVolume("vol. XIV")).toBe(14);
    expect(readVolume("sin número")).toBeNull();
    expect(readVolume(0)).toBeNull();
  });

  it("aplica también los registros guardados con la versión 1, sin organización ni portada", () => {
    const parsed = parseCatalogImportFile({
      entries: [{ fileName: "Meditaciones.pdf", publisher: "Gredos", title: "Meditaciones" }],
      pliegueCatalog: 1,
    });
    const [record] = createImportedCatalogRecords(parsed);
    // Así llegaban de IndexedDB antes de este cambio: sin los campos nuevos.
    const legacy = { ...record, bibliographic: { publisher: "Gredos" } } as unknown as NonNullable<
      typeof record
    >;
    delete (legacy as { cover?: unknown }).cover;
    delete (legacy as { organization?: unknown }).organization;

    const [applied] = applyImportedCatalogs([linkedDocument], [legacy]);

    expect(applied?.bibliographic).toMatchObject({ editors: [], publisher: "Gredos", volume: null });
    expect(applied?.organization).toEqual({ category: null, duplicateOf: null, subcategory: null });
    expect(applied?.cover).toBeUndefined();
  });
});

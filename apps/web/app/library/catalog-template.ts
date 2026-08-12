import { documentWorkTypes } from "../ai/document-catalog";
import { catalogImportVersion } from "./catalog-import";
import type { LibraryDocument } from "./documents";

/**
 * Esquema formal del intercambio. Viaja dentro de la propia plantilla para que el archivo se
 * pueda validar en cualquier editor sin acceso al repositorio, que es justo la situación de
 * quien lo rellena en una hoja de cálculo y lo exporta a JSON.
 */
export const catalogImportJsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  additionalProperties: true,
  properties: {
    entries: {
      items: {
        additionalProperties: false,
        properties: {
          authors: {
            description: "Autores de la obra, uno por elemento. Respeta la grafía original.",
            items: { type: "string" },
            type: "array",
          },
          doi: { description: "Identificador DOI, si lo tiene.", type: ["string", "null"] },
          edition: { description: "Edición: «2.ª», «revisada».", type: ["string", "null"] },
          fileName: {
            description: "Nombre del archivo con su extensión. Es lo que enlaza la ficha.",
            type: "string",
          },
          fingerprint: {
            description: "Huella nombre::tamaño::fecha. No la edites: identifica el archivo exacto.",
            type: ["string", "null"],
          },
          genres: {
            description: "Géneros: «Ensayo», «Novela», «Manual».",
            items: { type: "string" },
            type: "array",
          },
          isbn: { description: "ISBN-10 o ISBN-13.", type: ["string", "null"] },
          language: {
            description: "Idioma principal del documento: «español», «inglés».",
            type: ["string", "null"],
          },
          originalTitle: {
            description: "Título en el idioma original, si es una traducción.",
            type: ["string", "null"],
          },
          pageCount: { description: "Número de páginas.", type: ["integer", "null"] },
          publisher: { description: "Editorial.", type: ["string", "null"] },
          publicationYear: {
            description: "Año de publicación entre 1000 y 2100.",
            maximum: 2100,
            minimum: 1000,
            type: ["integer", "null"],
          },
          relativePath: {
            description: "Ruta dentro de la carpeta vinculada, si procede.",
            type: ["string", "null"],
          },
          rights: { description: "Licencia o nota de derechos.", type: ["string", "null"] },
          series: { description: "Colección o serie a la que pertenece.", type: ["string", "null"] },
          summary: {
            description: "Sinopsis de qué trata la obra, en 700 caracteres como máximo.",
            maxLength: 700,
            type: ["string", "null"],
          },
          title: { description: "Título canónico de la obra.", type: ["string", "null"] },
          topics: {
            description: "Temas tratados: «estoicismo», «arquitectura de software».",
            items: { type: "string" },
            type: "array",
          },
          translators: {
            description: "Personas que tradujeron la obra.",
            items: { type: "string" },
            type: "array",
          },
          url: { description: "Enlace de referencia de la obra.", type: ["string", "null"] },
          workType: {
            description: "Tipo de obra. Debe ser uno de los valores admitidos.",
            enum: documentWorkTypes,
            type: "string",
          },
        },
        required: ["fileName"],
        type: "object",
      },
      type: "array",
    },
    pliegueCatalog: { const: catalogImportVersion, type: "integer" },
  },
  required: ["pliegueCatalog", "entries"],
  type: "object",
} as const;

export const catalogTemplateInstructions = [
  "Rellena los campos que conozcas y deja el resto como están: un valor vacío no borra nada.",
  "No edites «fileName» ni «fingerprint»: son las señas con las que la ficha encuentra su archivo.",
  "Puedes añadir entradas de documentos que todavía no has vinculado; quedarán en espera y se aplicarán solas cuando vincules ese archivo.",
  `«workType» admite: ${documentWorkTypes.join(", ")}.`,
  "«authors», «genres», «topics» y «translators» son listas: escribe un elemento por autor o tema.",
  "También puedes importar una exportación CSL-JSON de Zotero, un volcado Dublin Core o un JSON-LD de schema.org sin convertirlo a este formato.",
] as const;

export interface CatalogTemplateEntry {
  authors: string[];
  doi: string | null;
  edition: string | null;
  fileName: string;
  fingerprint: string | null;
  genres: string[];
  isbn: string | null;
  language: string | null;
  originalTitle: string | null;
  pageCount: number | null;
  publicationYear: number | null;
  publisher: string | null;
  relativePath: string | null;
  rights: string | null;
  series: string | null;
  summary: string | null;
  title: string | null;
  topics: string[];
  translators: string[];
  url: string | null;
  workType: string;
}

export interface CatalogTemplate {
  $schema: typeof catalogImportJsonSchema;
  entries: CatalogTemplateEntry[];
  generatedAt: string;
  instructions: readonly string[];
  pliegueCatalog: typeof catalogImportVersion;
}

function documentFileName(document: LibraryDocument) {
  const record = document as LibraryDocument & { originalName?: string };
  if (record.originalName) return record.originalName;
  if (document.reference.kind === "local-folder") {
    return document.reference.relativePath.split("/").at(-1) ?? document.title;
  }
  return document.title;
}

/**
 * Vuelca el documento con la ficha que ya tenga. Devolver los campos vacíos en lugar de
 * omitirlos es intencional: quien abre el archivo ve de un vistazo qué falta por completar,
 * en vez de tener que deducir qué claves podría escribir.
 */
export function createCatalogTemplateEntry(document: LibraryDocument): CatalogTemplateEntry {
  const record = document as LibraryDocument & { fingerprint?: string };
  const catalog = document.catalog;

  return {
    authors: catalog?.authors ?? [],
    doi: null,
    edition: null,
    fileName: documentFileName(document),
    fingerprint: record.fingerprint ?? null,
    genres: catalog?.genres ?? [],
    isbn: null,
    language: catalog?.language ?? null,
    originalTitle: null,
    pageCount: null,
    publicationYear: catalog?.publicationYear ?? null,
    publisher: null,
    relativePath:
      document.reference.kind === "local-folder" ? document.reference.relativePath : null,
    rights: null,
    series: null,
    summary: catalog?.summary ?? null,
    title: catalog?.canonicalTitle ?? document.title,
    topics: catalog?.topics ?? [],
    translators: [],
    url: null,
    workType: catalog?.workType ?? "other",
  };
}

export function createCatalogTemplate(
  documents: readonly LibraryDocument[],
  generatedAt = new Date().toISOString(),
): CatalogTemplate {
  return {
    $schema: catalogImportJsonSchema,
    entries: documents.map(createCatalogTemplateEntry),
    generatedAt,
    instructions: catalogTemplateInstructions,
    pliegueCatalog: catalogImportVersion,
  };
}

export function serializeCatalogTemplate(template: CatalogTemplate) {
  return `${JSON.stringify(template, null, 2)}\n`;
}

export function catalogTemplateFileName(generatedAt = new Date().toISOString()) {
  return `pliegue-catalogo-${generatedAt.slice(0, 10)}.json`;
}

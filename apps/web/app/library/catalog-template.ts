import { documentWorkTypes } from "../ai/document-catalog";
import { catalogCoverSources, catalogImportVersion, maxCoverDataUriLength } from "./catalog-import";
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
          category: {
            description:
              "Materia principal, para filtrar y agrupar: «Filosofía», «Historia». Una por documento.",
            type: ["string", "null"],
          },
          confidence: {
            description: "Seguridad de la ficha entre 0 y 1. Una ficha escrita a mano vale 1.",
            maximum: 1,
            minimum: 0,
            type: "number",
          },
          cover: {
            description: `Portada como data URI de imagen (WebP, JPEG, PNG, AVIF o GIF), de ${Math.round(
              maxCoverDataUriLength / 1000,
            )} KB como máximo. Una URL de internet se ignora: mostrar la biblioteca no debe depender de la red.`,
            properties: {
              height: { type: ["integer", "null"] },
              source: { enum: catalogCoverSources, type: "string" },
              src: { type: "string" },
              width: { type: ["integer", "null"] },
            },
            required: ["src"],
            type: ["object", "null"],
          },
          doi: { description: "Identificador DOI, si lo tiene.", type: ["string", "null"] },
          duplicateOf: {
            description:
              "Si este archivo es una copia repetida, ruta o nombre del ejemplar principal. Permite ocultar duplicados.",
            type: ["string", "null"],
          },
          edition: { description: "Edición: «2.ª», «revisada».", type: ["string", "null"] },
          editors: {
            description: "Personas que editaron o coordinaron la obra.",
            items: { type: "string" },
            type: "array",
          },
          fileName: {
            description: "Nombre del archivo con su extensión. Es lo que enlaza la ficha.",
            type: "string",
          },
          fingerprint: {
            description: "Huella del archivo exacto. No la edites: la calcula Pliegue.",
            type: ["string", "null"],
          },
          genres: {
            description: "Forma de la obra: «Ensayo», «Novela», «Manual práctico», «Antología».",
            items: { type: "string" },
            type: "array",
          },
          isbn: { description: "ISBN-10 o ISBN-13.", type: ["string", "null"] },
          language: {
            description: "Idioma principal: código ISO («es», «en») o su nombre («español»).",
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
          sizeBytes: { description: "Tamaño del archivo en bytes.", type: ["integer", "null"] },
          subcategory: {
            description: "Afina la categoría: «Estoicismo», «Historia del Perú».",
            type: ["string", "null"],
          },
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
          volume: {
            description: "Número dentro de la serie: ordena los tomos. Admite «3», «Tomo 3» o «III».",
            type: ["integer", "string", "null"],
          },
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
    pliegueCatalog: { enum: [1, catalogImportVersion], type: "integer" },
    taxonomy: {
      description:
        "Opcional: el vocabulario de categorías que usa el archivo. Pliegue lo ignora al importar; sirve de guía a quien lo edita.",
      type: "object",
    },
  },
  required: ["pliegueCatalog", "entries"],
  type: "object",
} as const;

export const catalogTemplateInstructions = [
  "Rellena los campos que conozcas y deja el resto como están: un valor vacío no borra nada.",
  "No edites «fileName», «relativePath» ni «fingerprint»: son las señas con las que la ficha encuentra su archivo.",
  "Puedes añadir entradas de documentos que todavía no has vinculado; quedarán en espera y se aplicarán solas cuando vincules ese archivo.",
  "«category» es la materia (una por documento) y «subcategory» la afina; «genres» describe la forma de la obra, no su tema.",
  "«series» y «volume» ordenan colecciones: el tomo 9 irá después del 8 y no antes del 5.",
  "«duplicateOf» marca una copia repetida con la ruta del ejemplar principal; la Biblioteca puede ocultarlas.",
  "«cover» lleva la portada incrustada como data URI; una URL de internet se ignora.",
  `«workType» admite: ${documentWorkTypes.join(", ")}.`,
  "«authors», «genres», «topics», «translators» y «editors» son listas: escribe un elemento por persona o tema.",
  "También puedes importar una exportación CSL-JSON de Zotero, un volcado Dublin Core o un JSON-LD de schema.org sin convertirlo a este formato.",
] as const;

export interface CatalogTemplateCover {
  height: number | null;
  source: string;
  src: string;
  width: number | null;
}

export interface CatalogTemplateEntry {
  authors: string[];
  category: string | null;
  cover: CatalogTemplateCover | null;
  doi: string | null;
  duplicateOf: string | null;
  edition: string | null;
  editors: string[];
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
  subcategory: string | null;
  summary: string | null;
  title: string | null;
  topics: string[];
  translators: string[];
  url: string | null;
  volume: number | null;
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
 * en vez de tener que deducir qué claves podría escribir. Los datos bibliográficos, la
 * organización y la portada salen también: si no, exportar y volver a importar los perdería.
 */
export function createCatalogTemplateEntry(document: LibraryDocument): CatalogTemplateEntry {
  const record = document as LibraryDocument & { fingerprint?: string };
  const catalog = document.catalog;
  const bibliographic = document.bibliographic;
  const organization = document.organization;

  return {
    authors: catalog?.authors ?? [],
    category: organization?.category ?? null,
    cover: document.cover
      ? {
          height: document.cover.height,
          source: document.cover.source,
          src: document.cover.src,
          width: document.cover.width,
        }
      : null,
    doi: bibliographic?.doi ?? null,
    duplicateOf: organization?.duplicateOf ?? null,
    edition: bibliographic?.edition ?? null,
    editors: bibliographic?.editors ?? [],
    fileName: documentFileName(document),
    fingerprint: record.fingerprint ?? null,
    genres: catalog?.genres ?? [],
    isbn: bibliographic?.isbn ?? null,
    language: catalog?.language ?? null,
    originalTitle: bibliographic?.originalTitle ?? null,
    pageCount: bibliographic?.pageCount ?? null,
    publicationYear: catalog?.publicationYear ?? null,
    publisher: bibliographic?.publisher ?? null,
    relativePath:
      document.reference.kind === "local-folder" ? document.reference.relativePath : null,
    rights: bibliographic?.rights ?? null,
    series: bibliographic?.series ?? null,
    subcategory: organization?.subcategory ?? null,
    summary: catalog?.summary ?? null,
    title: catalog?.canonicalTitle ?? document.title,
    topics: catalog?.topics ?? [],
    translators: bibliographic?.translators ?? [],
    url: bibliographic?.url ?? null,
    volume: bibliographic?.volume ?? null,
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

/** Con la fecha local: de noche, la de UTC ya es la de mañana. */
export function catalogTemplateFileName(generatedAt: Date | string = new Date()) {
  const date = new Date(generatedAt);
  const day = [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part) => String(part).padStart(2, "0"))
    .join("-");
  return `pliegue-catalogo-${day}.json`;
}

export const catalogExampleFileName = "pliegue-catalogo-ejemplo.json";

/** Portada de muestra: 20 × 30 px, 125 bytes. Una real, en WebP a 300 px, ronda los 20 KB. */
const exampleCoverSrc =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAeCAMAAAAbzM5ZAAAACVBMVEU2W0j79uzJkjKQtiJmAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAGklEQVR42mNgGGjAiALwCRIPmOCAYRQMQgAAV3AAMUOOf+kAAAAASUVORK5CYII=";

/**
 * Archivo de ejemplo con tres casos que cubren casi todo: un tomo de una serie con su portada,
 * una copia repetida y una entrada mínima. Se genera desde el mismo esquema que valida la
 * importación, así que no puede quedarse atrás cuando el formato cambie.
 */
export function createCatalogExample(generatedAt = new Date().toISOString()) {
  return {
    $schema: catalogImportJsonSchema,
    entries: [
      {
        authors: ["Jorge Basadre Grohmann"],
        category: "Historia",
        confidence: 1,
        cover: { height: 30, source: "pdf-page", src: exampleCoverSrc, width: 20 },
        duplicateOf: null,
        editors: [],
        fileName: "TOMO-VIII-HP-Basadre.pdf",
        genres: ["Estudio académico"],
        isbn: "9786123063610",
        language: "es",
        pageCount: 303,
        publicationYear: 2014,
        publisher: "Empresa Editora El Comercio",
        relativePath: "Historia del Perú/TOMO-VIII-HP-Basadre.pdf",
        series: "Historia de la República del Perú",
        subcategory: "Historia del Perú",
        summary:
          "Tomo 8 de la Historia de la República del Perú: la crisis económica y hacendaria anterior a la guerra con Chile [1864-1878].",
        title:
          "Historia de la República del Perú. Tomo 8: La crisis económica y hacendaria anterior a la guerra con Chile",
        topics: ["Perú", "guano", "siglo XIX"],
        translators: [],
        volume: 8,
        workType: "book",
      },
      {
        authors: ["Robin Wall Kimmerer"],
        category: "Ciencia y naturaleza",
        duplicateOf: "Una trenza de hierba sagrada - Robin Wall Kimmerer.pdf",
        fileName: "Una trenza de hierba sagrada (copia).pdf",
        genres: ["Ensayo"],
        language: "es",
        subcategory: "Naturaleza y saber indígena",
        title: "Una trenza de hierba sagrada",
        workType: "book",
      },
      {
        authors: ["Jorge Luis Borges"],
        fileName: "el-jardin-de-senderos.docx",
        title: "El jardín de senderos que se bifurcan",
      },
    ],
    generatedAt,
    instructions: catalogTemplateInstructions,
    pliegueCatalog: catalogImportVersion,
    taxonomy: {
      categories: [
        { label: "Filosofía", subcategories: ["Estoicismo", "Filosofía antigua", "Filosofía contemporánea"] },
        { label: "Historia", subcategories: ["Historia del Perú"] },
        { label: "Ciencia y naturaleza", subcategories: ["Naturaleza y saber indígena"] },
        { label: "Literatura", subcategories: ["Cuento", "Novela"] },
      ],
    },
  };
}

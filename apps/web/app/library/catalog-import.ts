import {
  type DocumentCatalogMetadata,
  type DocumentWorkType,
  documentWorkTypes,
  parseDocumentCatalog,
} from "../ai/document-catalog";
import type { LibraryDocument } from "./documents";
import { normalizeLanguage } from "./language";

/**
 * Versión del contrato de intercambio. Viaja dentro del propio archivo para que una plantilla
 * descargada hoy siga siendo legible cuando el formato crezca: al subirla se sabe con qué
 * reglas se escribió en lugar de adivinarlo por la forma de los campos.
 *
 * 2 · añade la organización de la biblioteca (categoría, subcategoría, ejemplar duplicado),
 * el número de tomo, los editores y la portada. Un archivo de la versión 1 se sigue leyendo
 * igual: los campos nuevos quedan vacíos.
 */
export const catalogImportVersion = 2;

export const catalogImportDialects = ["csl-json", "dublin-core", "pliegue", "schema-org"] as const;

export type CatalogImportDialect = (typeof catalogImportDialects)[number];

/**
 * Datos bibliográficos que la ficha de IA no modela. Se conservan aparte en lugar de ampliar
 * `DocumentCatalogMetadata`: ese contrato lo comparten los tres proveedores y subirle campos
 * obligaría a reanalizar todo el corpus. Aquí solo los aporta una persona, y se guardan tal
 * cual para que un ISBN o un DOI escritos a mano no se pierdan.
 */
export interface CatalogBibliographicData {
  doi: string | null;
  edition: string | null;
  editors: string[];
  isbn: string | null;
  originalTitle: string | null;
  pageCount: number | null;
  publisher: string | null;
  rights: string | null;
  series: string | null;
  translators: string[];
  url: string | null;
  /** Número dentro de la serie: ordena los tomos 1, 2… 18 en lugar de alfabéticamente. */
  volume: number | null;
}

/**
 * Cómo se ordena la biblioteca. `category` es la materia (una por documento, para filtrar);
 * `subcategory` la afina. Son texto libre: el vocabulario lo decide quien escribe el JSON, y
 * la interfaz agrupa sin distinguir mayúsculas ni acentos.
 */
export interface CatalogOrganization {
  category: string | null;
  /** Ruta o nombre del ejemplar principal cuando este archivo es una copia repetida. */
  duplicateOf: string | null;
  subcategory: string | null;
}

export const catalogCoverSources = ["epub", "openlibrary", "pdf-image", "pdf-page", "other"] as const;
export type CatalogCoverSource = (typeof catalogCoverSources)[number];

/**
 * Portada incrustada como data URI. Se exige así, y no como URL, para que mostrar la
 * biblioteca no tenga que pedir nada a internet: el principio local-only se mantiene aunque
 * la imagen se haya buscado fuera al preparar el archivo.
 */
export interface CatalogCover {
  height: number | null;
  source: CatalogCoverSource;
  src: string;
  width: number | null;
}

/** Tope por portada: una miniatura de 300 px en WebP ocupa entre 10 y 40 KB. */
export const maxCoverDataUriLength = 400_000;

/** Señas del archivo al que pertenece la ficha, en orden decreciente de fiabilidad. */
export interface CatalogMatchHints {
  fileName: string | null;
  fingerprint: string | null;
  lastModified: number | null;
  relativePath: string | null;
  sizeBytes: number | null;
}

export interface CatalogImportEntry {
  bibliographic: CatalogBibliographicData;
  catalog: DocumentCatalogMetadata;
  cover: CatalogCover | null;
  hints: CatalogMatchHints;
  /** Claves de emparejamiento de esta ficha, de la más fuerte a la más débil. */
  matchKeys: string[];
  organization: CatalogOrganization;
  sourceLabel: string;
}

export interface CatalogImportIssue {
  position: number;
  reason: string;
  title: string | null;
}

export interface CatalogImportParseResult {
  dialect: CatalogImportDialect;
  entries: CatalogImportEntry[];
  issues: CatalogImportIssue[];
  /** Entradas que sí se importan, pero sin algo que traían: hoy, una portada inválida. */
  warnings: CatalogImportIssue[];
}

const emptyBibliographic: CatalogBibliographicData = {
  doi: null,
  edition: null,
  editors: [],
  isbn: null,
  originalTitle: null,
  pageCount: null,
  publisher: null,
  rights: null,
  series: null,
  translators: [],
  url: null,
  volume: null,
};

export const emptyOrganization: CatalogOrganization = {
  category: null,
  duplicateOf: null,
  subcategory: null,
};

/**
 * CSL describe 49 tipos y schema.org otros tantos; Pliegue solo distingue diez. El mapeo
 * agrupa por naturaleza de lectura, no por precisión bibliográfica: un capítulo se lee como
 * un libro y una entrada de blog como un artículo.
 */
const cslTypeToWorkType: Record<string, DocumentWorkType> = {
  article: "article",
  "article-journal": "article",
  "article-magazine": "article",
  "article-newspaper": "article",
  book: "book",
  chapter: "book",
  classic: "book",
  collection: "book",
  dataset: "spreadsheet",
  entry: "book",
  "entry-dictionary": "book",
  "entry-encyclopedia": "book",
  figure: "image",
  graphic: "image",
  manuscript: "other",
  map: "image",
  pamphlet: "other",
  "paper-conference": "presentation",
  performance: "presentation",
  periodical: "article",
  post: "article",
  "post-weblog": "article",
  report: "report",
  review: "article",
  "review-book": "article",
  speech: "presentation",
  standard: "report",
  thesis: "thesis",
};

const schemaOrgTypeToWorkType: Record<string, DocumentWorkType> = {
  article: "article",
  audiobook: "book",
  blogposting: "article",
  book: "book",
  digitaldocument: "other",
  imageobject: "image",
  newsarticle: "article",
  notedigitaldocument: "notes",
  photograph: "image",
  presentationdigitaldocument: "presentation",
  report: "report",
  scholarlyarticle: "article",
  spreadsheetdigitaldocument: "spreadsheet",
  techarticle: "article",
  textdigitaldocument: "other",
  thesis: "thesis",
};

/** Vocabulario DCMI Type. Es deliberadamente grueso: «Text» no dice si es libro o informe. */
const dublinCoreTypeToWorkType: Record<string, DocumentWorkType> = {
  collection: "other",
  dataset: "spreadsheet",
  image: "image",
  interactiveresource: "other",
  movingimage: "other",
  physicalobject: "other",
  service: "other",
  software: "other",
  sound: "other",
  stillimage: "image",
  text: "other",
};

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown) {
  if (typeof value === "string") {
    const cleaned = value.replaceAll(/\s+/g, " ").trim();
    return cleaned || null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function readInteger(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isInteger(parsed)) return parsed;
  }
  return null;
}

/** Acepta el valor suelto o la lista: los tres dialectos permiten ambas formas. */
function readList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value === undefined || value === null ? [] : [value];
}

function readStringList(value: unknown) {
  const result: string[] = [];

  for (const item of readList(value)) {
    const text = readString(item);
    if (!text) continue;
    // Dublin Core y schema.org admiten varios términos en un solo campo separados por comas
    // o punto y coma; sin partirlos, «Ensayo; Filosofía» entraría como un único género.
    for (const part of text.split(/[;,]/)) {
      const cleaned = part.trim();
      if (cleaned) result.push(cleaned);
    }
  }

  return result;
}

/** Un nombre puede venir como texto, como objeto CSL {family, given} o como Person de schema.org. */
function readName(value: unknown): string | null {
  const text = readString(value);
  if (text) return text;

  const record = asRecord(value);
  if (!record) return null;

  const literal = readString(record.literal) ?? readString(record.name);
  if (literal) return literal;

  const family = readString(record.family) ?? readString(record.familyName);
  const given = readString(record.given) ?? readString(record.givenName);
  const particle = readString(record["non-dropping-particle"]);
  const composed = [given, particle, family].filter(Boolean).join(" ");

  return composed || null;
}

function readNameList(value: unknown) {
  const result: string[] = [];
  for (const item of readList(value)) {
    const name = readName(item);
    if (name) result.push(name);
  }
  return result;
}

/**
 * Extrae el año de las tres representaciones posibles: el objeto CSL con `date-parts`, una
 * fecha ISO de schema.org y el texto libre de Dublin Core, donde «c. 1998» o «1998-2001» son
 * habituales.
 */
export function readPublicationYear(value: unknown): number | null {
  const direct = readInteger(value);
  if (direct !== null && direct >= 1000 && direct <= 2100) return direct;

  const record = asRecord(value);
  if (record) {
    const parts = record["date-parts"];
    if (Array.isArray(parts) && Array.isArray(parts[0])) {
      return readPublicationYear(parts[0][0]);
    }
    return readPublicationYear(record.raw ?? record.literal ?? record.year);
  }

  const text = readString(value);
  if (!text) return null;

  const year = /(1\d{3}|20\d{2}|2100)/.exec(text)?.[1];
  return year ? Number.parseInt(year, 10) : null;
}

function resolveWorkType(raw: unknown, dialect: CatalogImportDialect): DocumentWorkType {
  const text = readString(raw)?.toLocaleLowerCase("en");
  if (!text) return "other";

  const normalized = text.replace(/^(dcmitype:|schema:|https?:\/\/schema\.org\/)/, "");
  if (documentWorkTypes.includes(normalized as DocumentWorkType)) {
    return normalized as DocumentWorkType;
  }

  if (dialect === "csl-json") return cslTypeToWorkType[normalized] ?? "other";
  if (dialect === "schema-org") return schemaOrgTypeToWorkType[normalized] ?? "other";
  if (dialect === "dublin-core") return dublinCoreTypeToWorkType[normalized] ?? "other";
  return "other";
}

/**
 * Los espacios se colapsan aquí porque `readString` ya lo hizo al leer la ficha: un archivo
 * llamado «Morey, Miguel -  Foucault.pdf», con dos espacios, llegaría con uno solo y no
 * volvería a encontrar su documento. Los acentos se retiran por el mismo motivo: la forma de
 * normalización Unicode del sistema de archivos no tiene por qué coincidir con la del JSON.
 */
function normalizeMatchText(value: string) {
  return value
    .normalize("NFD")
    .replaceAll(/[\u0300-\u036f]/g, "")
    .replaceAll(/\s+/g, " ")
    .toLocaleLowerCase("en")
    .trim();
}

/**
 * Claves de emparejamiento por fiabilidad decreciente. El fingerprint identifica el archivo
 * exacto; la ruta distingue dos ficheros homónimos en carpetas distintas; el nombre es lo
 * único que una persona puede escribir a mano sin consultar nada, y por eso se admite último.
 */
export function catalogMatchKeys(hints: CatalogMatchHints) {
  const keys: string[] = [];
  const fingerprint =
    hints.fingerprint ??
    (hints.fileName && hints.sizeBytes !== null && hints.lastModified !== null
      ? `${hints.fileName.toLocaleLowerCase("en")}::${hints.sizeBytes}::${hints.lastModified}`
      : null);

  if (fingerprint) keys.push(`fingerprint:${normalizeMatchText(fingerprint)}`);
  if (hints.relativePath) keys.push(`path:${normalizeMatchText(hints.relativePath)}`);
  if (hints.fileName) keys.push(`name:${normalizeMatchText(hints.fileName)}`);

  return keys;
}

/** Las mismas claves vistas desde un documento ya presente en la biblioteca. */
export function documentMatchKeys(document: LibraryDocument) {
  const record = document as LibraryDocument & {
    fingerprint?: string;
    originalName?: string;
  };
  const relativePath =
    document.reference.kind === "local-folder" ? document.reference.relativePath : null;
  const fileName = record.originalName ?? relativePath?.split("/").at(-1) ?? null;

  return catalogMatchKeys({
    fileName,
    fingerprint: record.fingerprint ?? null,
    lastModified: null,
    relativePath,
    sizeBytes: null,
  });
}

function buildEntry(
  catalog: DocumentCatalogMetadata,
  bibliographic: CatalogBibliographicData,
  hints: CatalogMatchHints,
  fallbackLabel: string,
  extras: { cover?: CatalogCover | null; organization?: CatalogOrganization } = {},
): CatalogImportEntry | null {
  const matchKeys = catalogMatchKeys(hints);
  if (!matchKeys.length) return null;

  return {
    bibliographic,
    catalog,
    cover: extras.cover ?? null,
    hints,
    matchKeys,
    organization: extras.organization ?? emptyOrganization,
    sourceLabel: catalog.canonicalTitle ?? hints.fileName ?? fallbackLabel,
  };
}

const coverDataUriPattern = /^data:image\/(?:avif|gif|jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;

/**
 * Acepta la portada como objeto `{ src, width, height, source }` o como el data URI suelto.
 * Una URL externa se descarta a propósito (ver `CatalogCover`), igual que una imagen que
 * supere el tope: una portada no puede convertir el catálogo en un archivo de decenas de MB.
 */
export function readCover(value: unknown): CatalogCover | null {
  const record = asRecord(value);
  const src = readString(record ? (record.src ?? record.dataUri ?? record.url) : value);
  if (!src || src.length > maxCoverDataUriLength || !coverDataUriPattern.test(src)) return null;

  const source = readString(record?.source);
  const width = readInteger(record?.width);
  const height = readInteger(record?.height);

  return {
    height: height !== null && height > 0 ? height : null,
    source: catalogCoverSources.includes(source as CatalogCoverSource)
      ? (source as CatalogCoverSource)
      : "other",
    src,
    width: width !== null && width > 0 ? width : null,
  };
}

/**
 * Por qué se descarta la portada que trae una ficha, o `null` si no traía o es válida. Sin
 * este aviso, quien escribe el JSON a mano ve la ficha importada sin su portada y no sabe
 * que el problema era la URL o el tamaño.
 */
export function describeRejectedCover(value: unknown): string | null {
  if (value === undefined || value === null || value === "" || readCover(value)) return null;

  const record = asRecord(value);
  const src = readString(record ? (record.src ?? record.dataUri ?? record.url) : value);

  if (src && /^https?:\/\//i.test(src)) {
    return "La portada es una URL y Pliegue no descarga imágenes: incrústala como data URI («data:image/webp;base64,…»).";
  }
  if (src && src.length > maxCoverDataUriLength) {
    return `La portada ocupa ${src.length.toLocaleString("es")} caracteres y el tope es ${maxCoverDataUriLength.toLocaleString("es")}: redúcela a unos 300 px de ancho.`;
  }
  return "La portada no es una imagen incrustada válida: se espera un data URI en base64 de tipo avif, gif, jpeg, png o webp.";
}

function readOrganization(record: Record<string, unknown>): CatalogOrganization {
  return {
    category: readString(record.category),
    duplicateOf: readString(record.duplicateOf),
    subcategory: readString(record.subcategory),
  };
}

/** El tomo puede venir como número o como «Tomo 3», «vol. 12», «III». */
export function readVolume(value: unknown): number | null {
  const direct = readInteger(value);
  if (direct !== null) return direct > 0 && direct < 10_000 ? direct : null;

  const text = readString(value);
  if (!text) return null;
  const digits = /(\d{1,4})/.exec(text)?.[1];
  if (digits) return Number.parseInt(digits, 10);

  const roman = /\b([IVXLC]+)\b/i.exec(text)?.[1]?.toUpperCase();
  if (!roman) return null;
  const values: Record<string, number> = { C: 100, I: 1, L: 50, V: 5, X: 10 };
  let total = 0;
  for (let index = 0; index < roman.length; index += 1) {
    const current = values[roman[index] ?? ""] ?? 0;
    const next = values[roman[index + 1] ?? ""] ?? 0;
    total += current < next ? -current : current;
  }
  return total > 0 ? total : null;
}

function readBibliographic(
  record: Record<string, unknown>,
  keys: {
    doi?: string[];
    edition?: string[];
    editors?: string[];
    isbn?: string[];
    originalTitle?: string[];
    pageCount?: string[];
    publisher?: string[];
    rights?: string[];
    series?: string[];
    translators?: string[];
    url?: string[];
    volume?: string[];
  },
): CatalogBibliographicData {
  function first(candidates: string[] | undefined) {
    for (const key of candidates ?? []) {
      const value = readString(record[key]);
      if (value) return value;
    }
    return null;
  }

  return {
    doi: first(keys.doi),
    edition: first(keys.edition),
    editors: (keys.editors ?? []).flatMap((key) => readNameList(record[key])),
    isbn: first(keys.isbn),
    originalTitle: first(keys.originalTitle),
    pageCount: readInteger(
      (keys.pageCount ?? []).map((key) => record[key]).find((value) => value !== undefined),
    ),
    publisher: first(keys.publisher),
    rights: first(keys.rights),
    series: first(keys.series),
    translators: (keys.translators ?? []).flatMap((key) => readNameList(record[key])),
    url: first(keys.url),
    volume: readVolume(
      (keys.volume ?? []).map((key) => record[key]).find((value) => value !== undefined),
    ),
  };
}

/**
 * Una ficha escrita por una persona vale como evidencia directa, así que entra con confianza
 * plena salvo que el archivo declare otra cosa. La ficha inferida por un modelo sí gradúa su
 * confianza, y mezclarlas sin esta distinción dejaría lo humano por debajo de lo estimado.
 */
function readConfidence(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 1;
}

function readPliegueEntry(value: unknown, position: number): CatalogImportEntry | null {
  const record = asRecord(value);
  if (!record) return null;

  const catalog = parseDocumentCatalog({
    authors: readNameList(record.authors ?? record.author),
    canonicalTitle: readString(record.canonicalTitle ?? record.title),
    confidence: readConfidence(record.confidence),
    genres: readStringList(record.genres ?? record.genre),
    language: normalizeLanguage(readString(record.language)),
    publicationYear: readPublicationYear(record.publicationYear ?? record.year ?? record.date),
    summary: readString(record.summary ?? record.abstract),
    topics: readStringList(record.topics ?? record.keywords ?? record.tags),
    workType: resolveWorkType(record.workType ?? record.type, "pliegue"),
  });

  return buildEntry(
    catalog,
    readBibliographic(record, {
      doi: ["doi", "DOI"],
      edition: ["edition"],
      editors: ["editors"],
      isbn: ["isbn", "ISBN"],
      originalTitle: ["originalTitle"],
      pageCount: ["pageCount", "numberOfPages"],
      publisher: ["publisher"],
      rights: ["rights", "license"],
      series: ["series"],
      translators: ["translators"],
      url: ["url", "URL"],
      volume: ["volume", "volumeNumber"],
    }),
    {
      fileName: readString(record.fileName ?? record.file ?? record.originalName),
      fingerprint: readString(record.fingerprint),
      lastModified: readInteger(record.lastModified),
      relativePath: readString(record.relativePath ?? record.path),
      sizeBytes: readInteger(record.sizeBytes ?? record.size),
    },
    `Entrada ${position}`,
    { cover: readCover(record.cover), organization: readOrganization(record) },
  );
}

function readCslEntry(value: unknown, position: number): CatalogImportEntry | null {
  const record = asRecord(value);
  if (!record) return null;

  const catalog = parseDocumentCatalog({
    authors: readNameList(record.author),
    canonicalTitle: readString(record.title),
    confidence: readConfidence(undefined),
    genres: readStringList(record.genre ?? record["collection-title"]),
    language: normalizeLanguage(readString(record.language)),
    publicationYear: readPublicationYear(record.issued ?? record["original-date"]),
    summary: readString(record.abstract),
    topics: readStringList(record.keyword),
    workType: resolveWorkType(record.type, "csl-json"),
  });

  return buildEntry(
    catalog,
    readBibliographic(record, {
      doi: ["DOI"],
      edition: ["edition"],
      editors: ["editor"],
      isbn: ["ISBN"],
      originalTitle: ["original-title"],
      pageCount: ["number-of-pages"],
      publisher: ["publisher"],
      rights: ["rights"],
      series: ["collection-title"],
      translators: ["translator"],
      url: ["URL"],
      volume: ["volume"],
    }),
    {
      // CSL no describe archivos. `note` y `call-number` son donde Zotero deja el adjunto,
      // y sin una de las dos la ficha no puede engancharse a ningún documento local.
      fileName: readString(record.file ?? record["call-number"] ?? record.note),
      fingerprint: null,
      lastModified: null,
      relativePath: null,
      sizeBytes: null,
    },
    `Entrada ${position}`,
  );
}

function readDublinCoreEntry(value: unknown, position: number): CatalogImportEntry | null {
  const record = asRecord(value);
  if (!record) return null;

  // Los volcados de Dublin Core alternan entre «title», «dc:title» y «dcterms:title».
  const field = (name: string) =>
    record[name] ?? record[`dc:${name}`] ?? record[`dcterms:${name}`];

  const catalog = parseDocumentCatalog({
    authors: readNameList(field("creator")),
    canonicalTitle: readString(field("title")),
    confidence: readConfidence(undefined),
    genres: readStringList(field("subject")),
    language: normalizeLanguage(readString(field("language"))),
    publicationYear: readPublicationYear(field("date") ?? field("issued")),
    summary: readString(field("description") ?? field("abstract")),
    topics: readStringList(field("subject")),
    workType: resolveWorkType(field("type"), "dublin-core"),
  });

  const identifier = readString(field("identifier"));

  return buildEntry(
    catalog,
    {
      ...emptyBibliographic,
      isbn: identifier?.toLocaleLowerCase("en").includes("isbn") ? identifier : null,
      publisher: readString(field("publisher")),
      rights: readString(field("rights")),
      translators: readNameList(field("contributor")),
      url: identifier?.startsWith("http") ? identifier : null,
    },
    {
      fileName: readString(field("source") ?? record.fileName) ?? identifier,
      fingerprint: null,
      lastModified: null,
      relativePath: readString(field("relation")),
      sizeBytes: null,
    },
    `Entrada ${position}`,
  );
}

function readSchemaOrgEntry(value: unknown, position: number): CatalogImportEntry | null {
  const record = asRecord(value);
  if (!record) return null;

  const catalog = parseDocumentCatalog({
    authors: readNameList(record.author ?? record.creator),
    canonicalTitle: readString(record.name ?? record.headline),
    confidence: readConfidence(undefined),
    genres: readStringList(record.genre),
    language: normalizeLanguage(readString(record.inLanguage)),
    publicationYear: readPublicationYear(record.datePublished ?? record.copyrightYear),
    summary: readString(record.abstract ?? record.description),
    topics: readStringList(record.keywords ?? record.about),
    workType: resolveWorkType(record["@type"], "schema-org"),
  });

  const publisher = record.publisher;

  return buildEntry(
    catalog,
    {
      ...emptyBibliographic,
      edition: readString(record.bookEdition),
      isbn: readString(record.isbn),
      pageCount: readInteger(record.numberOfPages),
      publisher: readName(publisher),
      rights: readString(record.license ?? record.copyrightNotice),
      translators: readNameList(record.translator),
      url: readString(record.url ?? record.sameAs),
    },
    {
      fileName: readString(record.fileName ?? record.contentUrl ?? record.encodingFormat),
      fingerprint: null,
      lastModified: null,
      relativePath: null,
      sizeBytes: null,
    },
    `Entrada ${position}`,
  );
}

/**
 * Reconoce el dialecto por sus marcas propias en vez de pedírselo al usuario: quien exporta
 * de Zotero o de un repositorio institucional no sabe —ni tiene por qué— cómo se llama el
 * formato que acaba de descargar.
 */
export function detectCatalogDialect(value: unknown): CatalogImportDialect | null {
  const record = asRecord(value);
  if (record && (record.pliegueCatalog !== undefined || Array.isArray(record.entries))) {
    return "pliegue";
  }

  const sample = asRecord(Array.isArray(value) ? value[0] : value);
  if (!sample) return null;

  if (sample["@type"] !== undefined || sample["@context"] !== undefined) return "schema-org";
  if (sample.type !== undefined && (sample.title !== undefined || sample.id !== undefined)) {
    return "csl-json";
  }
  if (
    sample.creator !== undefined ||
    Object.keys(sample).some((key) => key.startsWith("dc:") || key.startsWith("dcterms:"))
  ) {
    return "dublin-core";
  }
  if (sample.fileName !== undefined || sample.fingerprint !== undefined) return "pliegue";

  return null;
}

const dialectReaders: Record<
  CatalogImportDialect,
  (value: unknown, position: number) => CatalogImportEntry | null
> = {
  "csl-json": readCslEntry,
  "dublin-core": readDublinCoreEntry,
  pliegue: readPliegueEntry,
  "schema-org": readSchemaOrgEntry,
};

export function parseCatalogImportFile(value: unknown): CatalogImportParseResult {
  const dialect = detectCatalogDialect(value);

  if (!dialect) {
    throw new Error(
      "No se reconoce el formato. Usa la plantilla de Pliegue o una exportación CSL-JSON, Dublin Core o schema.org.",
    );
  }

  const container = asRecord(value);
  const rawEntries = Array.isArray(value)
    ? value
    : Array.isArray(container?.entries)
      ? container.entries
      : Array.isArray(container?.["@graph"])
        ? container["@graph"]
        : [value];

  const read = dialectReaders[dialect];
  const entries: CatalogImportEntry[] = [];
  const issues: CatalogImportIssue[] = [];
  const warnings: CatalogImportIssue[] = [];

  rawEntries.forEach((raw, index) => {
    const position = index + 1;
    const record = asRecord(raw);

    try {
      const entry = read(raw, position);
      if (entry) {
        entries.push(entry);
        // Solo la plantilla propia lee portadas; en los demás dialectos «cover» no significa nada.
        const coverProblem = dialect === "pliegue" ? describeRejectedCover(record?.cover) : null;
        if (coverProblem) warnings.push({ position, reason: coverProblem, title: entry.sourceLabel });
        return;
      }

      issues.push({
        position,
        reason: record
          ? "Falta el nombre del archivo: sin él la ficha no puede asociarse a ningún documento."
          : "La entrada no es un objeto.",
        title: record ? readString(record.title ?? record.name ?? record.canonicalTitle) : null,
      });
    } catch (error) {
      issues.push({
        position,
        reason: error instanceof Error ? error.message : "Entrada ilegible.",
        title: record ? readString(record.title ?? record.name) : null,
      });
    }
  });

  return { dialect, entries, issues, warnings };
}

export interface ImportedCatalogRecord {
  bibliographic: CatalogBibliographicData;
  catalog: DocumentCatalogMetadata;
  /** Ausente en los registros guardados con la versión 1. */
  cover?: CatalogCover | null;
  dialect: CatalogImportDialect;
  importedAt: string;
  /** Clave primaria del registro: la más fuerte de las disponibles en la ficha. */
  matchKey: string;
  matchKeys: string[];
  /** Ausente en los registros guardados con la versión 1. */
  organization?: CatalogOrganization;
  schemaVersion: number;
  sourceLabel: string;
}

export function createImportedCatalogRecords(
  result: CatalogImportParseResult,
  importedAt = new Date().toISOString(),
): ImportedCatalogRecord[] {
  const byKey = new Map<string, ImportedCatalogRecord>();

  for (const entry of result.entries) {
    const [matchKey] = entry.matchKeys;
    if (!matchKey) continue;

    // Dos entradas para el mismo archivo dentro de un archivo: gana la última, que es lo que
    // espera quien corrige una línea y vuelve a pegarla más abajo.
    byKey.set(matchKey, {
      bibliographic: entry.bibliographic,
      catalog: entry.catalog,
      cover: entry.cover,
      dialect: result.dialect,
      importedAt,
      matchKey,
      matchKeys: entry.matchKeys,
      organization: entry.organization,
      schemaVersion: catalogImportVersion,
      sourceLabel: entry.sourceLabel,
    });
  }

  return [...byKey.values()];
}

export interface CatalogMatchResult {
  byDocumentId: Map<string, ImportedCatalogRecord>;
  pending: ImportedCatalogRecord[];
}

/**
 * El emparejamiento se resuelve en memoria contra la biblioteca del momento, no se congela al
 * importar. Así una ficha que hoy no encuentra su archivo se aplica sola en cuanto se vincule,
 * sin pedir al usuario que vuelva a subir el mismo JSON.
 */
export function matchImportedCatalogs(
  documents: readonly LibraryDocument[],
  records: readonly ImportedCatalogRecord[],
): CatalogMatchResult {
  const documentsByKey = new Map<string, LibraryDocument>();

  for (const document of documents) {
    for (const key of documentMatchKeys(document)) {
      if (!documentsByKey.has(key)) documentsByKey.set(key, document);
    }
  }

  const byDocumentId = new Map<string, ImportedCatalogRecord>();
  const pending: ImportedCatalogRecord[] = [];

  for (const record of records) {
    // Se recorren de la clave más fuerte a la más débil: el fingerprint manda sobre la ruta,
    // y la ruta sobre un nombre que puede repetirse en varias carpetas.
    const document = record.matchKeys
      .map((key) => documentsByKey.get(key))
      .find((candidate) => candidate !== undefined);

    if (!document) {
      pending.push(record);
      continue;
    }

    const previous = byDocumentId.get(document.id);
    if (!previous || previous.importedAt <= record.importedAt) {
      byDocumentId.set(document.id, record);
    }
  }

  return { byDocumentId, pending };
}

/**
 * La ficha importada pisa a la deducida por el modelo. Es deliberado: quien escribe el JSON
 * está corrigiendo lo que la IA no supo ver, y el orden inverso convertiría cada análisis
 * posterior en una regresión silenciosa de un dato verificado a mano.
 *
 * Con la ficha viajan los datos bibliográficos, la organización y la portada. Antes solo se
 * aplicaba `catalog`: la editorial, la serie o el ISBN se guardaban y no llegaban nunca al
 * documento, así que al volver a exportar la plantilla desaparecían.
 */
export function applyImportedCatalogs(
  documents: readonly LibraryDocument[],
  records: readonly ImportedCatalogRecord[],
): LibraryDocument[] {
  const { byDocumentId } = matchImportedCatalogs(documents, records);
  if (!byDocumentId.size) return [...documents];

  return documents.map((document) => {
    const record = byDocumentId.get(document.id);
    if (!record) return document;

    // Se descarta el error del último análisis: la ficha ya existe y arrastrarlo dejaría el
    // documento marcado como fallido cuando en realidad está catalogado.
    const { catalogError, ...rest } = document;
    void catalogError;

    return {
      ...rest,
      bibliographic: { ...emptyBibliographic, ...record.bibliographic },
      catalog: record.catalog,
      catalogSource: "import" as const,
      catalogStatus: "analyzed" as const,
      ...(record.cover ? { cover: record.cover } : {}),
      organization: { ...emptyOrganization, ...record.organization },
    };
  });
}

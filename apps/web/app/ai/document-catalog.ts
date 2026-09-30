import type { LibraryDocument } from "../library/documents";

export const aiProviders = ["openai", "anthropic", "gemini", "ollama"] as const;
export const documentWorkTypes = [
  "book",
  "essay",
  "article",
  "report",
  "thesis",
  "presentation",
  "spreadsheet",
  "notes",
  "image",
  "other",
] as const;

export type AiProvider = (typeof aiProviders)[number];
export type DocumentWorkType = (typeof documentWorkTypes)[number];
export type CatalogAnalysisStatus = "analyzed" | "analyzing" | "error" | "needs-content";

export interface DocumentCatalogMetadata {
  authors: string[];
  canonicalTitle: string | null;
  confidence: number;
  genres: string[];
  language: string | null;
  publicationYear: number | null;
  summary: string | null;
  topics: string[];
  workType: DocumentWorkType;
}

/**
 * Lo que la ficha de la plantilla JSON tiene y `DocumentCatalogMetadata` no: la materia con la
 * que se ordena la biblioteca y los datos de la edición que suelen estar en la portada y en la
 * página de créditos. Va aparte porque la ficha importada los guarda en `organization` y
 * `bibliographic`, y así cada uno llega a su sitio sin tocar el contrato que comparten.
 */
export interface CatalogExtras {
  category: string | null;
  edition: string | null;
  editors: string[];
  isbn: string | null;
  originalTitle: string | null;
  publisher: string | null;
  series: string | null;
  subcategory: string | null;
  translators: string[];
  volume: number | null;
}

export const emptyCatalogExtras: CatalogExtras = {
  category: null,
  edition: null,
  editors: [],
  isbn: null,
  originalTitle: null,
  publisher: null,
  series: null,
  subcategory: null,
  translators: [],
  volume: null,
};

export interface DocumentCatalogRecord {
  analyzedAt: string;
  catalog: DocumentCatalogMetadata | null;
  documentId: string;
  error: string | null;
  /** Ausente en las fichas anteriores a la versión 4 del prompt. */
  extras?: CatalogExtras;
  inputFingerprint: string;
  model: string;
  provider: AiProvider;
  schemaVersion: 1;
  status: CatalogAnalysisStatus;
}

export interface CatalogDocumentInput {
  excerpt: string;
  format: string;
  /**
   * Autores ya presentes en el catálogo. Se envían para que el modelo reutilice la grafía
   * establecida en vez de abrir una entrada paralela; la reconciliación posterior no depende
   * de que obedezca, pero cuando lo hace el resultado es mejor y no hay que corregirlo.
   */
  knownAuthors?: string[];
  /**
   * Categorías que ya usa la biblioteca, como «Historia › Historia del Perú». Con ellas el
   * modelo no abre «Historia peruana» al lado de «Historia del Perú».
   */
  knownCategories?: string[];
  path: string | null;
  title: string;
}

/** Consumo declarado por el proveedor para una llamada. */
export interface CatalogUsage {
  inputTokens: number;
  outputTokens: number;
}

export const emptyCatalogUsage: CatalogUsage = { inputTokens: 0, outputTokens: 0 };

/**
 * Cada proveedor nombra sus contadores de otra forma y los coloca donde quiere: OpenAI y
 * Anthropic bajo `usage`, Gemini bajo `usageMetadata`, Ollama en la raíz de la respuesta. Se buscan en ambos sitios para no
 * repetir esta lógica en cada adaptador. Un proveedor que no informe deja el consumo en cero,
 * que es preferible a estimarlo y presentar un número inventado como si fuera medido.
 */
export function readCatalogUsage(source: unknown): CatalogUsage {
  const root = (source ?? {}) as Record<string, unknown>;
  const nested = (root.usage ?? root.usageMetadata ?? {}) as Record<string, unknown>;
  const read = (...keys: string[]) => {
    for (const key of keys) {
      for (const scope of [nested, root]) {
        const value = scope[key];
        if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
      }
    }
    return 0;
  };

  return {
    inputTokens: read("input_tokens", "prompt_tokens", "promptTokenCount", "prompt_eval_count"),
    // Gemini cuenta aparte lo que piensa, y también se factura como salida.
    outputTokens:
      read("output_tokens", "completion_tokens", "candidatesTokenCount", "eval_count") +
      read("thoughtsTokenCount"),
  };
}

export function addCatalogUsage(left: CatalogUsage, right: CatalogUsage): CatalogUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
  };
}

export const documentCatalogJsonSchema = {
  additionalProperties: false,
  properties: {
    authors: { items: { type: "string" }, type: "array" },
    canonicalTitle: { type: ["string", "null"] },
    category: { type: ["string", "null"] },
    confidence: { maximum: 1, minimum: 0, type: "number" },
    edition: { type: ["string", "null"] },
    editors: { items: { type: "string" }, type: "array" },
    genres: { items: { type: "string" }, type: "array" },
    isbn: { type: ["string", "null"] },
    language: { type: ["string", "null"] },
    originalTitle: { type: ["string", "null"] },
    publicationYear: { type: ["integer", "null"] },
    publisher: { type: ["string", "null"] },
    series: { type: ["string", "null"] },
    subcategory: { type: ["string", "null"] },
    summary: { type: ["string", "null"] },
    topics: { items: { type: "string" }, type: "array" },
    translators: { items: { type: "string" }, type: "array" },
    volume: { type: ["integer", "null"] },
    workType: { enum: documentWorkTypes, type: "string" },
  },
  // La salida estricta de OpenAI exige que todo campo figure como obligatorio: el «no sé» se
  // dice con null o con una lista vacía, no omitiendo la clave.
  required: [
    "authors",
    "canonicalTitle",
    "category",
    "confidence",
    "edition",
    "editors",
    "genres",
    "isbn",
    "language",
    "originalTitle",
    "publicationYear",
    "publisher",
    "series",
    "subcategory",
    "summary",
    "topics",
    "translators",
    "volume",
    "workType",
  ],
  type: "object",
} as const;

/**
 * Versión del prompt y del contrato de ficha. Entra en el fingerprint: al subirla, los
 * documentos ya catalogados se vuelven a analizar en lugar de conservar fichas creadas con
 * instrucciones antiguas. ADR-0002 exige versionar los prompts aparte del binario.
 */
/**
 * 3 · añade las reglas de atribución y la lista de autores ya conocidos. Las tres primeras
 * nacen de errores observados al catalogar un corpus real: la editorial de un resumen figuraba
 * como autora de la obra resumida, y varios ensayos entraban como «libro» sin más.
 */
/**
 * 4 · la ficha trae también lo que tiene la plantilla JSON: categoría y subcategoría, editorial,
 * serie y tomo, edición, ISBN, título original, traductores y editores. Antes solo se llenaban
 * importando un JSON, y analizar con IA dejaba la biblioteca sin organizar.
 */
export const catalogPromptVersion = 4;
export const maxSummaryCharacters = 700;
/** Más allá de esto la lista de autores conocidos encarece cada llamada sin aportar. */
export const maxKnownAuthorsInPrompt = 60;
export const maxKnownCategoriesInPrompt = 60;

/**
 * Materias de partida cuando la biblioteca aún no tiene ninguna: amplias, como las secciones de
 * una biblioteca general, para que veinte libros no acaben en veinte categorías.
 */
export const suggestedCategories = [
  "Filosofía",
  "Religión y espiritualidad",
  "Psicología",
  "Ciencias sociales",
  "Política y derecho",
  "Economía y empresa",
  "Historia",
  "Biografías y memorias",
  "Literatura",
  "Arte y arquitectura",
  "Música",
  "Ciencia y naturaleza",
  "Matemáticas",
  "Tecnología e informática",
  "Medicina y salud",
  "Educación",
  "Lengua y lingüística",
  "Desarrollo personal",
  "Viajes y geografía",
] as const;

export const catalogSystemPrompt = [
  "Eres un catalogador bibliográfico preciso.",
  "Trabajas sobre un extracto del propio documento: úsalo como evidencia principal y apóyate en el título y la ruta solo como pistas secundarias.",
  "Extrae metadatos únicamente cuando estén respaldados por esa evidencia.",
  "No inventes autores, fecha, género ni idioma. Usa null o una lista vacía cuando no haya evidencia suficiente.",
  "El año de publicación suele aparecer en la página de créditos o copyright; el autor, en la portada.",
  "Distingue el tipo de obra: libro, ensayo, artículo, informe, tesis, presentación, hoja de cálculo, notas, imagen u otro.",
  "Usa \"essay\" cuando la obra argumenta una tesis propia aunque se publique como libro, y \"notes\" para resúmenes, apuntes y material de apoyo.",
  "En \"authors\" va quien escribió la obra. Nunca pongas la editorial, el traductor, el prologuista, el compilador digital ni el servicio que distribuye el archivo.",
  "Si el documento es un resumen, una sinopsis comercial o una guía sobre otra obra, el autor es el de la obra original y el tipo es \"notes\"; menciona en la sinopsis que se trata de un resumen y quién lo elabora.",
  "Respeta la grafía de los nombres propios.",
  "En \"category\" va la materia principal de la obra, en español y amplia, como la sección de una biblioteca general; una sola. En \"subcategory\", en español, la afina (\"Estoicismo\", \"Historia del Perú\"); null si no hace falta.",
  `Si no se te ofrecen categorías de la biblioteca, elige una de estas cuando encaje: ${suggestedCategories.join(", ")}.`,
  "Si se te ofrecen categorías ya usadas en la biblioteca y una encaja, devuelve exactamente esa grafía y, si la trae, su subcategoría; abre una nueva solo cuando ninguna sirva.",
  "\"publisher\" es la editorial de esta edición, tal como figura en la portada o en los créditos; nunca la web o el servicio que distribuye el archivo.",
  "\"series\" es la colección o serie y \"volume\" el número de tomo como entero (\"Tomo VIII\" es 8).",
  "\"isbn\", \"edition\" y \"originalTitle\" (el título en su idioma original si es una traducción) solo si aparecen en el extracto; \"translators\" y \"editors\" son personas, una por elemento.",
  "Si se te ofrece una lista de autores ya presentes en el catálogo y el autor de este documento es uno de ellos, devuelve exactamente esa grafía, aunque la portada la abrevie o la escriba de otro modo.",
  `En "summary" escribe una sinopsis de qué trata la obra en ${maxSummaryCharacters} caracteres como máximo:`,
  "tema central, enfoque o tesis, y alcance. Tres o cuatro frases, en el idioma del documento.",
  "Describe el contenido, no el archivo: nunca menciones el formato, el nombre del fichero ni su ruta.",
  "Si el extracto no permite saber de qué trata, devuelve null en lugar de una descripción vaga.",
].join(" ");

function cleanNullableString(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const cleaned = value.replaceAll(/\s+/g, " ").trim().slice(0, maxLength);
  return cleaned || null;
}

function cleanStringArray(value: unknown, maxItems: number) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of value) {
    const cleaned = cleanNullableString(item, 96);
    if (!cleaned) continue;
    const key = cleaned.toLocaleLowerCase("es");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
    if (result.length === maxItems) break;
  }

  return result;
}

export function parseDocumentCatalog(value: unknown): DocumentCatalogMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("El proveedor no devolvió un catálogo válido.");
  }

  const candidate = value as Record<string, unknown>;
  const publicationYear =
    typeof candidate.publicationYear === "number" &&
    Number.isInteger(candidate.publicationYear) &&
    candidate.publicationYear >= 1000 &&
    candidate.publicationYear <= 2100
      ? candidate.publicationYear
      : null;
  const workType = documentWorkTypes.includes(candidate.workType as DocumentWorkType)
    ? (candidate.workType as DocumentWorkType)
    : "other";
  const rawConfidence =
    typeof candidate.confidence === "number" && Number.isFinite(candidate.confidence)
      ? candidate.confidence
      : 0;

  return {
    authors: cleanStringArray(candidate.authors, 12),
    canonicalTitle: cleanNullableString(candidate.canonicalTitle, 240),
    confidence: Math.min(1, Math.max(0, rawConfidence)),
    genres: cleanStringArray(candidate.genres, 8),
    language: cleanNullableString(candidate.language, 64),
    publicationYear,
    summary: cleanNullableString(candidate.summary, maxSummaryCharacters),
    topics: cleanStringArray(candidate.topics, 12),
    workType,
  };
}

/** ISBN-10 o ISBN-13 sin guiones ni espacios; cualquier otra cosa no es un ISBN. */
function cleanIsbn(value: unknown) {
  if (typeof value !== "string") return null;
  const compact = value.replaceAll(/[^0-9Xx]/g, "").toUpperCase();
  return /^(\d{9}[\dX]|\d{13})$/.test(compact) ? compact : null;
}

/**
 * Lee de la misma respuesta lo que va más allá de `DocumentCatalogMetadata`. Una respuesta sin
 * estos campos —de un modelo que no los devolvió— queda en blanco en vez de fallar: la ficha
 * básica sigue valiendo.
 */
export function parseCatalogExtras(value: unknown): CatalogExtras {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyCatalogExtras;
  const candidate = value as Record<string, unknown>;
  const volume =
    typeof candidate.volume === "number" &&
    Number.isInteger(candidate.volume) &&
    candidate.volume > 0 &&
    candidate.volume < 10_000
      ? candidate.volume
      : null;
  const category = cleanNullableString(candidate.category, 80);

  return {
    category,
    edition: cleanNullableString(candidate.edition, 80),
    editors: cleanStringArray(candidate.editors, 8),
    isbn: cleanIsbn(candidate.isbn),
    originalTitle: cleanNullableString(candidate.originalTitle, 240),
    publisher: cleanNullableString(candidate.publisher, 160),
    series: cleanNullableString(candidate.series, 200),
    // Una subcategoría sin categoría no ordena nada: se descarta.
    subcategory: category ? cleanNullableString(candidate.subcategory, 80) : null,
    translators: cleanStringArray(candidate.translators, 8),
    volume,
  };
}

export function selectCatalogExcerpt(value: string, maxCharacters: number) {
  const normalized = value.replaceAll(/\s+/g, " ").trim();
  if (normalized.length <= maxCharacters) return normalized;

  const headLength = Math.floor(maxCharacters * 0.72);
  const tailLength = maxCharacters - headLength;
  return `${normalized.slice(0, headLength)}\n[… extracto intermedio omitido …]\n${normalized.slice(-tailLength)}`;
}

export function createCatalogDocumentInput(
  document: LibraryDocument,
  maxExcerptCharacters: number,
  knownAuthors: readonly string[] = [],
  knownCategories: readonly string[] = [],
): CatalogDocumentInput {
  return {
    excerpt: selectCatalogExcerpt(document.searchText ?? "", maxExcerptCharacters),
    format: document.format,
    ...(knownAuthors.length
      ? { knownAuthors: knownAuthors.slice(0, maxKnownAuthorsInPrompt) }
      : {}),
    ...(knownCategories.length
      ? { knownCategories: knownCategories.slice(0, maxKnownCategoriesInPrompt) }
      : {}),
    path:
      document.reference.kind === "local-folder" ? document.reference.relativePath : null,
    title: document.title,
  };
}

export function createCatalogPrompt(input: CatalogDocumentInput) {
  const known = input.knownAuthors?.length
    ? `Autores ya presentes en el catálogo: ${input.knownAuthors.join("; ")}`
    : "";
  const categories = input.knownCategories?.length
    ? `Categorías ya usadas en la biblioteca: ${input.knownCategories.join("; ")}`
    : "";

  return [
    `Título observado: ${input.title}`,
    `Formato: ${input.format}`,
    input.path ? `Ruta relativa: ${input.path}` : "",
    known,
    categories,
    "\nExtracto local:",
    input.excerpt,
  ]
    .filter(Boolean)
    .join("\n");
}

function fnv1a(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function createCatalogInputFingerprint(
  document: LibraryDocument,
  provider: AiProvider,
  model: string,
  maxExcerptCharacters: number,
) {
  const version =
    "fingerprint" in document && typeof document.fingerprint === "string"
      ? document.fingerprint
      : `${document.indexedAt ?? ""}:${document.searchText?.length ?? 0}`;
  const excerpt = selectCatalogExcerpt(document.searchText ?? "", maxExcerptCharacters);
  return `v${catalogPromptVersion}:${fnv1a(
    [version, provider, model, String(catalogPromptVersion), excerpt].join("\u241f"),
  )}`;
}

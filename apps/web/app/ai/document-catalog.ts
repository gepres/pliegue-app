import type { LibraryDocument } from "../library/documents";

export const aiProviders = ["openai", "anthropic", "ollama"] as const;
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

export interface DocumentCatalogRecord {
  analyzedAt: string;
  catalog: DocumentCatalogMetadata | null;
  documentId: string;
  error: string | null;
  inputFingerprint: string;
  model: string;
  provider: AiProvider;
  schemaVersion: 1;
  status: CatalogAnalysisStatus;
}

export interface CatalogDocumentInput {
  excerpt: string;
  format: string;
  path: string | null;
  title: string;
}

export const documentCatalogJsonSchema = {
  additionalProperties: false,
  properties: {
    authors: { items: { type: "string" }, type: "array" },
    canonicalTitle: { type: ["string", "null"] },
    confidence: { maximum: 1, minimum: 0, type: "number" },
    genres: { items: { type: "string" }, type: "array" },
    language: { type: ["string", "null"] },
    publicationYear: { type: ["integer", "null"] },
    summary: { type: ["string", "null"] },
    topics: { items: { type: "string" }, type: "array" },
    workType: { enum: documentWorkTypes, type: "string" },
  },
  required: [
    "authors",
    "canonicalTitle",
    "confidence",
    "genres",
    "language",
    "publicationYear",
    "summary",
    "topics",
    "workType",
  ],
  type: "object",
} as const;

export const catalogSystemPrompt = [
  "Eres un catalogador documental preciso.",
  "Extrae metadatos únicamente cuando estén respaldados por el título, la ruta o el extracto.",
  "No inventes autores, fecha, género ni idioma. Usa null o una lista vacía cuando no haya evidencia suficiente.",
  "Distingue el tipo de obra: libro, ensayo, artículo, informe, tesis, presentación, hoja de cálculo, notas, imagen u otro.",
  "Devuelve los nombres propios respetando su grafía y una síntesis factual de máximo 280 caracteres.",
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
    summary: cleanNullableString(candidate.summary, 280),
    topics: cleanStringArray(candidate.topics, 12),
    workType,
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
): CatalogDocumentInput {
  return {
    excerpt: selectCatalogExcerpt(document.searchText ?? "", maxExcerptCharacters),
    format: document.format,
    path:
      document.reference.kind === "local-folder" ? document.reference.relativePath : null,
    title: document.title,
  };
}

export function createCatalogPrompt(input: CatalogDocumentInput) {
  return [
    `Título observado: ${input.title}`,
    `Formato: ${input.format}`,
    input.path ? `Ruta relativa: ${input.path}` : "",
    "",
    "Extracto local:",
    input.excerpt,
  ]
    .filter((part, index) => Boolean(part) || index === 3)
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
  return `v1:${fnv1a([version, provider, model, excerpt].join("\u241f"))}`;
}

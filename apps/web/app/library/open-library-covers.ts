import type { CatalogCover } from "./catalog-import";
import type { LibraryDocument } from "./documents";

/**
 * Buscar portadas en Open Library (03.11, criterio 6). Es opcional y lo lanza la persona: sale
 * del dispositivo el título, el autor y el ISBN de cada libro sin portada, nunca el archivo.
 * Lo que vuelve se guarda como miniatura incrustada, así que mostrar la Biblioteca sigue sin
 * hacer ninguna petición de red.
 *
 * Con ISBN se pide la portada de esa edición. Sin él se busca por título y autor y solo se
 * acepta un resultado cuyo título coincida de verdad: una portada equivocada es peor que la
 * tipográfica.
 */

export interface CoverQuery {
  authors: string[];
  documentId: string;
  isbn: string | null;
  title: string;
}

export type CoverLookup =
  | { cover: CatalogCover; kind: "found"; via: "isbn" | "search" }
  | { kind: "not-found" };

export interface CoverLookupOptions {
  fetcher?: typeof fetch;
  signal?: AbortSignal;
  /** Convierte la imagen descargada en una portada incrustada (en el navegador, con canvas). */
  toCover: (image: Blob) => Promise<CatalogCover | null>;
}

const searchBase = "https://openlibrary.org/search.json";
const coversBase = "https://covers.openlibrary.org/b";

/**
 * ¿Le hace falta portada? Las que no tienen y las que solo tienen la primera página del PDF,
 * que en los escaneos suele ser publicidad o una doble página. La portada declarada del EPUB y
 * la del índice JSON (la que genera la IA) se respetan.
 */
export function needsCover(document: Pick<LibraryDocument, "cover">) {
  return !document.cover || document.cover.source === "pdf-page";
}

/**
 * Título y autor sacados del nombre, para cuando no hay ficha. Sigue la convención
 * «Título - Autor.pdf». El título que muestra la app ya cambió los guiones por espacios, así que
 * « - » llega como tres espacios seguidos: se aceptan las dos formas.
 */
export function titleAndAuthorFromName(name: string) {
  const base = name.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/_+/g, " ");
  const [title = "", ...rest] = base.split(/\s+[-–—]\s+|\s{3,}/);
  const author = rest.join(" ").replace(/\s+/g, " ").trim();
  return { author: author || null, title: title.replace(/\s+/g, " ").trim() };
}

/** Solo dígitos y la X final: «978-84-376-0494-7» → «9788437604947». */
export function cleanIsbn(value: string | null | undefined) {
  const isbn = (value ?? "").replace(/[^0-9Xx]/g, "").toUpperCase();
  return isbn.length === 10 || isbn.length === 13 ? isbn : null;
}

export function coverQueryFor(
  document: Pick<LibraryDocument, "bibliographic" | "catalog" | "id" | "title"> & { originalName?: string },
): CoverQuery | null {
  // Sin ficha, el nombre del archivo: el original si se conoce (las copias lo guardan).
  const fromName = titleAndAuthorFromName(document.originalName ?? document.title);
  const title = (document.catalog?.canonicalTitle ?? fromName.title).trim();
  if (title.length < 2) return null;
  // `author` del documento es un rótulo («Copia importada»), no un nombre: los autores salen de
  // la ficha o, sin ella, del nombre «Título - Autor».
  const authors = document.catalog?.authors.length ? document.catalog.authors : fromName.author ? [fromName.author] : [];
  return { authors, documentId: document.id, isbn: cleanIsbn(document.bibliographic?.isbn), title };
}

/** Minúsculas, sin tildes ni signos, sin artículos al principio. */
export function normalizeTitle(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]+/g, " ")
    .replace(/^(el|la|los|las|un|una|the|a|an|le|les|il|lo)\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** El título sin su subtítulo: lo que va tras «:», «.», «(» o « - » no cambia de libro. */
function mainTitle(value: string) {
  return normalizeTitle(value.split(/\s*[:.(]\s*|\s+[-–—]\s+/)[0] ?? "");
}

/**
 * ¿Cómo casan dos títulos? `exact` si son el mismo; `subtitle` si solo los separa un subtítulo
 * («Meditaciones» y «Meditaciones: escritos para sí mismo»). Empezar igual no basta:
 * «Meditaciones metafísicas» es otro libro, y «La niebla y otros cuentos», también.
 */
export function titleMatch(wanted: string, candidate: string): "exact" | "subtitle" | null {
  const a = normalizeTitle(wanted);
  const b = normalizeTitle(candidate);
  if (!a || !b) return null;
  if (a === b) return "exact";
  const wantedMain = mainTitle(wanted);
  const candidateMain = mainTitle(candidate);
  return candidateMain.length >= 2 && (candidateMain === a || wantedMain === b || candidateMain === wantedMain)
    ? "subtitle"
    : null;
}

export function titlesMatch(wanted: string, candidate: string) {
  return titleMatch(wanted, candidate) !== null;
}

export function openLibrarySearchUrl(query: CoverQuery) {
  const url = new URL(searchBase);
  url.searchParams.set("title", query.title);
  const [author] = query.authors;
  if (author) url.searchParams.set("author", author);
  url.searchParams.set("fields", "title,cover_i");
  url.searchParams.set("limit", "5");
  return url.toString();
}

export function isbnCoverUrl(isbn: string) {
  // `default=false`: sin portada responde 404 en lugar de una imagen en blanco.
  return `${coversBase}/isbn/${isbn}-M.jpg?default=false`;
}

export function idCoverUrl(coverId: number) {
  return `${coversBase}/id/${coverId}-M.jpg`;
}

async function downloadImage(url: string, options: CoverLookupOptions) {
  const response = await (options.fetcher ?? fetch)(url, { signal: options.signal ?? null });
  if (!response.ok) return null;
  const image = await response.blob();
  // Una imagen de un píxel o un texto de error no son una portada.
  return image.size > 1_000 && image.type.startsWith("image/") ? image : null;
}

export async function findOpenLibraryCover(query: CoverQuery, options: CoverLookupOptions): Promise<CoverLookup> {
  const fetcher = options.fetcher ?? fetch;

  if (query.isbn) {
    const image = await downloadImage(isbnCoverUrl(query.isbn), options);
    const cover = image ? await options.toCover(image) : null;
    if (cover) return { cover, kind: "found", via: "isbn" };
  }

  const response = await fetcher(openLibrarySearchUrl(query), { signal: options.signal ?? null });
  if (!response.ok) throw new Error(`Open Library respondió ${response.status}.`);
  const payload = (await response.json()) as { docs?: Array<{ cover_i?: number; title?: string }> };
  const withCover = (payload.docs ?? []).filter(
    (doc): doc is { cover_i: number; title: string } => typeof doc.cover_i === "number" && typeof doc.title === "string",
  );
  // Primero el título idéntico; si no lo hay, el mismo con subtítulo.
  const match =
    withCover.find((doc) => titleMatch(query.title, doc.title) === "exact") ??
    withCover.find((doc) => titleMatch(query.title, doc.title) === "subtitle");
  if (!match?.cover_i) return { kind: "not-found" };

  const image = await downloadImage(idCoverUrl(match.cover_i), options);
  const cover = image ? await options.toCover(image) : null;
  return cover ? { cover, kind: "found", via: "search" } : { kind: "not-found" };
}

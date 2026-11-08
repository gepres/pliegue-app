import { cleanIsbn, normalizeTitle } from "./open-library-covers";

/**
 * Recomendaciones «Para ti» (06.1), sin servidor propio ni IA por defecto:
 *
 * 1. Las señales: los **gustos declarados** (temas y autores que la persona elige) y, solo si lo
 *    activa, los de **su biblioteca** (autores y géneros de las fichas; los favoritos cuentan
 *    doble), sin los libros confidenciales ni los personales.
 * 2. Con ellas se busca en **Open Library**: por tema (en inglés, que es como los tiene, con
 *    libros en español y orden por valoración) y por autor. Sale el tema o el nombre del autor,
 *    nunca un título de la biblioteca.
 * 3. Se quita lo que ya está en la biblioteca y lo que se marcó «No me interesa», se puntúa y
 *    cada recomendación dice **por qué**.
 */

export interface TasteSubject {
  id: string;
  /** Cómo se enseña. */
  label: string;
  /** El tema en Open Library (en inglés). */
  query: string;
  /** Palabras que, en un género o tema de una ficha, apuntan a este tema. */
  matches: readonly string[];
}

export const tasteSubjects: readonly TasteSubject[] = [
  { id: "realismo-magico", label: "Realismo mágico", matches: ["realismo magico", "real maravilloso"], query: "magic realism" },
  { id: "novela-historica", label: "Novela histórica", matches: ["novela historica", "historica"], query: "historical fiction" },
  { id: "ciencia-ficcion", label: "Ciencia ficción", matches: ["ciencia ficcion", "distopia", "space opera"], query: "science fiction" },
  { id: "fantasia", label: "Fantasía", matches: ["fantasia", "fantastico", "fantastica"], query: "fantasy" },
  { id: "policial", label: "Novela negra y policial", matches: ["policial", "novela negra", "misterio", "thriller", "suspenso"], query: "detective and mystery stories" },
  { id: "terror", label: "Terror", matches: ["terror", "horror", "gotico"], query: "horror" },
  { id: "romance", label: "Romántica", matches: ["romance", "romantica", "amor"], query: "love stories" },
  { id: "cuento", label: "Cuentos", matches: ["cuento", "cuentos", "relato", "relatos"], query: "short stories" },
  { id: "poesia", label: "Poesía", matches: ["poesia", "poemas", "poetica"], query: "poetry" },
  { id: "teatro", label: "Teatro", matches: ["teatro", "drama", "dramaturgia"], query: "drama" },
  { id: "clasicos", label: "Clásicos", matches: ["clasico", "clasicos"], query: "classic literature" },
  { id: "latinoamericana", label: "Literatura latinoamericana", matches: ["latinoamerican", "hispanoamerican", "boom"], query: "latin american fiction" },
  { id: "juvenil", label: "Infantil y juvenil", matches: ["juvenil", "infantil", "ninos"], query: "juvenile fiction" },
  { id: "filosofia", label: "Filosofía", matches: ["filosofia", "etica", "metafisica"], query: "philosophy" },
  { id: "historia", label: "Historia", matches: ["historia", "historiografia"], query: "history" },
  { id: "biografia", label: "Biografías y memorias", matches: ["biografia", "memorias", "autobiografia"], query: "biography" },
  { id: "psicologia", label: "Psicología", matches: ["psicologia", "psicoanalisis"], query: "psychology" },
  { id: "divulgacion", label: "Ciencia y divulgación", matches: ["divulgacion", "ciencia", "fisica", "biologia", "astronomia"], query: "popular science" },
  { id: "economia", label: "Economía y negocios", matches: ["economia", "negocios", "finanzas", "empresa"], query: "economics" },
  { id: "desarrollo-personal", label: "Desarrollo personal", matches: ["autoayuda", "desarrollo personal", "espiritualidad", "meditacion"], query: "self-help" },
  { id: "arte", label: "Arte y fotografía", matches: ["arte", "fotografia", "pintura", "arquitectura"], query: "art" },
  { id: "viajes", label: "Viajes", matches: ["viaje", "viajes", "cronica de viaje"], query: "travel" },
];

export function subjectById(id: string) {
  return tasteSubjects.find((subject) => subject.id === id) ?? null;
}

/** Sin tildes, en minúsculas y sin signos: para comparar géneros y nombres. */
export function fold(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, " ")
    .trim();
}

/** El tema que corresponde a un género o tema de una ficha («Novela de ciencia ficción» → ciencia ficción). */
export function subjectForGenre(genre: string) {
  const folded = ` ${fold(genre)} `;
  return tasteSubjects.find((subject) => subject.matches.some((match) => folded.includes(` ${match}`))) ?? null;
}

/* ---- Lo que la persona declara ----------------------------------------------------------------------- */

export interface TasteProfile {
  authors: string[];
  /** Obras que marcó «No me interesa» (clave de Open Library). */
  dismissed: string[];
  enabled: boolean;
  subjects: string[];
  updatedAt: string | null;
  /** ¿Puede usarse su biblioteca (autores y géneros de las fichas, y los favoritos)? */
  useLibrary: boolean;
}

export const emptyTasteProfile: TasteProfile = { authors: [], dismissed: [], enabled: false, subjects: [], updatedAt: null, useLibrary: false };

export function parseTasteProfile(value: unknown): TasteProfile {
  if (!value || typeof value !== "object") return emptyTasteProfile;
  const raw = value as Record<string, unknown>;
  const strings = (list: unknown, max: number, limit: number) =>
    Array.isArray(list) ? [...new Set(list.filter((item): item is string => typeof item === "string").map((item) => item.trim().slice(0, limit)).filter(Boolean))].slice(0, max) : [];
  return {
    authors: strings(raw.authors, 12, 80),
    dismissed: strings(raw.dismissed, 300, 40),
    enabled: raw.enabled === true,
    subjects: strings(raw.subjects, 12, 40).filter((id) => subjectById(id)),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null,
    useLibrary: raw.useLibrary === true,
  };
}

/* ---- Lo que dice la biblioteca (solo con permiso) -------------------------------------------------- */

export interface LibraryBookSignal {
  authors: readonly string[];
  favorite: boolean;
  genres: readonly string[];
  title: string;
}

export interface LibrarySignals {
  authors: Array<{ count: number; name: string }>;
  subjects: Array<{ count: number; id: string }>;
}

/** Los autores y temas que más se repiten (un favorito cuenta doble). Ya sin los libros sensibles. */
export function librarySignals(books: readonly LibraryBookSignal[]): LibrarySignals {
  const authors = new Map<string, { count: number; name: string }>();
  const subjects = new Map<string, number>();
  for (const book of books) {
    const weight = book.favorite ? 2 : 1;
    for (const name of book.authors.slice(0, 2)) {
      const key = fold(name);
      if (key.length < 3) continue;
      const entry = authors.get(key) ?? { count: 0, name };
      authors.set(key, { count: entry.count + weight, name: entry.name });
    }
    for (const genre of book.genres) {
      const subject = subjectForGenre(genre);
      if (subject) subjects.set(subject.id, (subjects.get(subject.id) ?? 0) + weight);
    }
  }
  return {
    authors: [...authors.values()].sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, "es")),
    subjects: [...subjects.entries()].map(([id, count]) => ({ count, id })).sort((left, right) => right.count - left.count),
  };
}

/* ---- Qué se busca --------------------------------------------------------------------------------------- */

export interface RecommendationQuery {
  kind: "author" | "subject";
  /** Lo que se le pasa a Open Library: el tema en inglés o el nombre del autor. */
  value: string;
  /** Lo que se enseña en el porqué. */
  label: string;
  source: "declared" | "library";
}

/** Hasta 4 temas y 3 autores: los declarados primero; con permiso, los de la biblioteca. */
export function recommendationQueries(profile: TasteProfile, signals: LibrarySignals | null): RecommendationQuery[] {
  const subjects: RecommendationQuery[] = [];
  const authors: RecommendationQuery[] = [];
  const add = (list: RecommendationQuery[], query: RecommendationQuery, max: number) => {
    if (list.length < max && !list.some((item) => fold(item.value) === fold(query.value))) list.push(query);
  };
  for (const id of profile.subjects) {
    const subject = subjectById(id);
    if (subject) add(subjects, { kind: "subject", label: subject.label, source: "declared", value: subject.query }, 4);
  }
  for (const name of profile.authors) add(authors, { kind: "author", label: name, source: "declared", value: name }, 3);
  if (profile.useLibrary && signals) {
    for (const { id } of signals.subjects) {
      const subject = subjectById(id);
      if (subject) add(subjects, { kind: "subject", label: subject.label, source: "library", value: subject.query }, 4);
    }
    for (const { name } of signals.authors) add(authors, { kind: "author", label: name, source: "library", value: name }, 3);
  }
  return [...subjects, ...authors];
}

export const openLibrarySearch = "https://openlibrary.org/search.json";
const searchFields = "key,title,author_name,first_publish_year,cover_i,language,ratings_average,ratings_count,editions,editions.title,editions.language,editions.isbn";

export function openLibraryUrl(query: RecommendationQuery) {
  const params = new URLSearchParams({ fields: searchFields, limit: query.kind === "subject" ? "16" : "10", sort: "rating" });
  if (query.kind === "subject") params.set("q", `subject:"${query.value.replaceAll('"', "")}" language:spa`);
  else {
    params.set("author", query.value);
    params.set("q", "language:spa");
  }
  return `${openLibrarySearch}?${params}`;
}

/** Buscar un libro concreto (una sugerencia de la IA) por título y autor. */
export function openLibraryBookUrl(title: string, author: string) {
  return `${openLibrarySearch}?${new URLSearchParams({ author, fields: searchFields, limit: "5", title })}`;
}

/* ---- Lo que vuelve -------------------------------------------------------------------------------------- */

export interface Candidate {
  author: string | null;
  coverId: number | null;
  isbn: string | null;
  /** Clave de la obra en Open Library («/works/OL…W»). */
  key: string;
  rating: number | null;
  ratings: number;
  title: string;
  year: number | null;
}

/** ¿Está en otro alfabeto (japonés, ruso…)? Entonces se enseña el título de la edición en español. */
const nonLatin = /[^\u0000-ɏḀ-ỿ\s\p{P}\p{N}]/u;

export function parseCandidates(raw: unknown): Candidate[] {
  const docs = (raw as { docs?: unknown[] } | null)?.docs;
  if (!Array.isArray(docs)) return [];
  const candidates: Candidate[] = [];
  for (const doc of docs) {
    const item = doc as Record<string, unknown>;
    const key = typeof item.key === "string" ? item.key : "";
    const workTitle = typeof item.title === "string" ? item.title.trim() : "";
    if (!key.startsWith("/works/") || !workTitle) continue;
    const edition = ((item.editions as { docs?: Array<Record<string, unknown>> } | undefined)?.docs ?? [])[0] ?? {};
    const editionLanguages = Array.isArray(edition.language) ? (edition.language as string[]) : [];
    const spanishEdition = editionLanguages.length > 0 && editionLanguages.every((language) => language === "spa");
    const editionTitle = typeof edition.title === "string" ? edition.title.trim() : "";
    const title = nonLatin.test(workTitle) && editionTitle && spanishEdition ? editionTitle : workTitle;
    if (nonLatin.test(title)) continue;
    const isbns = Array.isArray(edition.isbn) ? (edition.isbn as string[]) : [];
    candidates.push({
      author: Array.isArray(item.author_name) && typeof item.author_name[0] === "string" ? item.author_name[0] : null,
      coverId: typeof item.cover_i === "number" ? item.cover_i : null,
      isbn: spanishEdition ? (isbns.map(cleanIsbn).find(Boolean) ?? null) : null,
      key,
      rating: typeof item.ratings_average === "number" ? item.ratings_average : null,
      ratings: typeof item.ratings_count === "number" ? item.ratings_count : 0,
      title,
      year: typeof item.first_publish_year === "number" ? item.first_publish_year : null,
    });
  }
  return candidates;
}

export interface RecommendationReason {
  kind: "author" | "subject" | "ai";
  source: "declared" | "library" | "ai";
  text: string;
}

export interface Recommendation extends Candidate {
  reasons: RecommendationReason[];
  score: number;
}

/** El porqué, en una frase. */
export function reasonFor(query: RecommendationQuery): RecommendationReason {
  if (query.kind === "author") {
    return { kind: "author", source: query.source, text: query.source === "declared" ? `De ${query.label}, que te gusta` : `De ${query.label}, a quien lees` };
  }
  return { kind: "subject", source: query.source, text: query.source === "declared" ? `Porque te interesa: ${query.label.toLocaleLowerCase("es")}` : `Por lo que lees: ${query.label.toLocaleLowerCase("es")}` };
}

export interface RankOptions {
  dismissed: readonly string[];
  /** Títulos (y autores) de la biblioteca: lo que ya se tiene no se recomienda. */
  owned: ReadonlyArray<{ authors: readonly string[]; title: string }>;
  limit?: number;
}

/**
 * Junta lo que devolvió cada búsqueda, quita lo que ya se tiene o se descartó, y ordena: cuantas
 * más razones, mejor; luego la valoración (con algo de peso por el número de votos) y la portada.
 * Como mucho 2 libros del mismo autor, para que no sea una sola voz.
 */
export function rankRecommendations(results: ReadonlyArray<{ candidates: readonly Candidate[]; query: RecommendationQuery }>, { dismissed, limit = 18, owned }: RankOptions): Recommendation[] {
  const ownedTitles = new Set(owned.map((book) => normalizeTitle(book.title)).filter(Boolean));
  const byKey = new Map<string, Recommendation>();
  for (const { candidates, query } of results) {
    for (const candidate of candidates) {
      if (dismissed.includes(candidate.key) || ownedTitles.has(normalizeTitle(candidate.title))) continue;
      const entry = byKey.get(candidate.key) ?? { ...candidate, reasons: [], score: 0 };
      const reason = reasonFor(query);
      if (!entry.reasons.some((item) => item.text === reason.text)) entry.reasons.push(reason);
      byKey.set(candidate.key, entry);
    }
  }
  const scored = [...byKey.values()].map((item) => ({
    ...item,
    score:
      item.reasons.reduce((sum, reason) => sum + (reason.kind === "author" ? 3 : 2) + (reason.source === "declared" ? 1 : 0), 0) +
      (item.rating ?? 0) * Math.min(1, item.ratings / 20) +
      (item.coverId ? 0.5 : 0),
  }));
  scored.sort((left, right) => right.score - left.score || (right.year ?? 0) - (left.year ?? 0));
  const perAuthor = new Map<string, number>();
  const chosen: Recommendation[] = [];
  for (const item of scored) {
    const author = fold(item.author ?? "");
    if (author && (perAuthor.get(author) ?? 0) >= 2) continue;
    perAuthor.set(author, (perAuthor.get(author) ?? 0) + 1);
    chosen.push(item);
    if (chosen.length >= limit) break;
  }
  return chosen;
}

export function coverUrl(coverId: number) {
  return `https://covers.openlibrary.org/b/id/${coverId}-M.jpg`;
}

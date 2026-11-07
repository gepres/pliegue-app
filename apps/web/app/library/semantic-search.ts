/**
 * Recuperar fragmentos (04.4): búsqueda híbrida. Por palabras (BM25, sin mayúsculas ni acentos),
 * que funciona siempre y en el equipo, y por significado (coseno entre embeddings), cuando el
 * libro tiene vectores. Las dos listas se juntan por su puesto (Reciprocal Rank Fusion), que no
 * necesita que las puntuaciones sean comparables.
 *
 * El alcance (qué fuentes, qué libros) se aplica dentro de la consulta, antes de puntuar, y no al
 * enseñar los resultados: un fragmento fuera del alcance no compite ni se cuenta (09-ai, «Reglas
 * de confianza»).
 */

/* ---- Palabras ------------------------------------------------------------------------------------ */

const stopwords = new Set(
  (
    "a al algo ante como con contra cual cuando de del desde donde durante e el ella ellas ellos en entre era es esa ese eso esta este esto fue ha hay la las le les lo los mas me mi mucho muy ni no nos o os para pero poco por que quien se ser si sin sobre su sus tambien te tu un una uno unos unas y ya yo " +
    "an and are as at be but by for from has have he her his i in into is it its of on or our she that the their them there they this to was we were what when which who will with you"
  ).split(" "),
);

/** Minúsculas, sin acentos y en palabras; sin las vacías («de», «the»). */
export function searchTerms(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase("es")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length > 1 && !stopwords.has(term));
}

export interface LexicalIndex {
  averageLength: number;
  lengths: number[];
  /** Por palabra, los fragmentos donde sale y cuántas veces. */
  postings: Map<string, Array<[number, number]>>;
}

export function buildLexicalIndex(texts: readonly string[]): LexicalIndex {
  const postings = new Map<string, Array<[number, number]>>();
  const lengths: number[] = [];
  texts.forEach((text, index) => {
    const terms = searchTerms(text);
    lengths.push(terms.length);
    const counts = new Map<string, number>();
    for (const term of terms) counts.set(term, (counts.get(term) ?? 0) + 1);
    for (const [term, count] of counts) {
      const list = postings.get(term);
      if (list) list.push([index, count]);
      else postings.set(term, [[index, count]]);
    }
  });
  const total = lengths.reduce((sum, length) => sum + length, 0);
  return { averageLength: lengths.length ? total / lengths.length : 0, lengths, postings };
}

/**
 * BM25 (k1 = 1,2; b = 0,75) solo entre los fragmentos permitidos: la frecuencia de cada palabra
 * se cuenta dentro del alcance, así que otro libro fuera de él no cambia el orden.
 */
export function lexicalScores(index: LexicalIndex, query: string, allowed: (chunk: number) => boolean) {
  const scores = new Map<number, number>();
  const terms = [...new Set(searchTerms(query))];
  let allowedCount = 0;
  let allowedLength = 0;
  index.lengths.forEach((length, chunk) => {
    if (!allowed(chunk)) return;
    allowedCount += 1;
    allowedLength += length;
  });
  if (!allowedCount || !terms.length) return scores;
  const averageLength = allowedLength / allowedCount || 1;
  for (const term of terms) {
    const postings = (index.postings.get(term) ?? []).filter(([chunk]) => allowed(chunk));
    if (!postings.length) continue;
    const idf = Math.log(1 + (allowedCount - postings.length + 0.5) / (postings.length + 0.5));
    for (const [chunk, count] of postings) {
      const length = index.lengths[chunk] ?? 0;
      const score = (idf * (count * 2.2)) / (count + 1.2 * (0.25 + (0.75 * length) / averageLength));
      scores.set(chunk, (scores.get(chunk) ?? 0) + score);
    }
  }
  return scores;
}

/* ---- Vectores ------------------------------------------------------------------------------------- */

export interface QuantizedVector {
  data: Int8Array;
  /** Para volver a la escala del vector normalizado: valor ≈ data[i] × scale. */
  scale: number;
}

export function normalizeVector(vector: readonly number[]): Float32Array {
  const norm = Math.hypot(...vector) || 1;
  return Float32Array.from(vector, (value) => value / norm);
}

/**
 * Un vector en 8 bits: cuatro veces menos que en 32, y el orden de los resultados casi no cambia.
 * Un libro de 500 fragmentos con 768 dimensiones ocupa unos 380 KB.
 */
export function quantize(vector: readonly number[]): QuantizedVector {
  const normalized = normalizeVector(vector);
  let max = 0;
  for (const value of normalized) max = Math.max(max, Math.abs(value));
  const scale = max / 127 || 1;
  return { data: Int8Array.from(normalized, (value) => Math.round(value / scale)), scale };
}

/** Coseno entre una pregunta (normalizada) y un fragmento cuantizado. */
export function cosine(query: Float32Array, chunk: QuantizedVector) {
  if (query.length !== chunk.data.length) return 0;
  let sum = 0;
  for (let index = 0; index < query.length; index += 1) sum += (query[index] ?? 0) * (chunk.data[index] ?? 0);
  return sum * chunk.scale;
}

/* ---- Juntar las dos listas ------------------------------------------------------------------------- */

const rrfK = 60;

function ranked(scores: Map<number, number>) {
  return [...scores.entries()].filter(([, score]) => score > 0).sort((left, right) => right[1] - left[1]);
}

export interface FusedHit {
  chunk: number;
  /** Puesto en cada lista (1 = el primero), o null si no salió en ella. */
  lexicalRank: number | null;
  score: number;
  semanticRank: number | null;
}

/**
 * Reciprocal Rank Fusion: cada lista aporta 1 / (60 + puesto). Lo que sale arriba en las dos gana;
 * lo que sale solo en una, también cuenta.
 */
export function fuseRankings(lexical: Map<number, number>, semantic: Map<number, number>, limit = 20): FusedHit[] {
  const hits = new Map<number, FusedHit>();
  const add = (list: Array<[number, number]>, field: "lexicalRank" | "semanticRank") => {
    list.forEach(([chunk], position) => {
      const hit = hits.get(chunk) ?? { chunk, lexicalRank: null, score: 0, semanticRank: null };
      hit[field] = position + 1;
      hit.score += 1 / (rrfK + position + 1);
      hits.set(chunk, hit);
    });
  };
  add(ranked(lexical).slice(0, 200), "lexicalRank");
  add(ranked(semantic).slice(0, 200), "semanticRank");
  return [...hits.values()].sort((left, right) => right.score - left.score).slice(0, limit);
}

/** Como mucho `perDocument` fragmentos de cada libro, para que uno solo no llene la lista. */
export function diversify<Hit>(hits: readonly Hit[], documentOf: (hit: Hit) => string, perDocument = 3) {
  const counts = new Map<string, number>();
  return hits.filter((hit) => {
    const document = documentOf(hit);
    const count = counts.get(document) ?? 0;
    counts.set(document, count + 1);
    return count < perDocument;
  });
}

/** Un trozo del fragmento alrededor de la primera palabra buscada, para enseñarlo. */
export function snippetFor(text: string, query: string, length = 240) {
  const terms = searchTerms(query);
  const plain = text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es");
  const found = terms.map((term) => plain.indexOf(term)).filter((position) => position >= 0);
  const at = found.length ? Math.min(...found) : 0;
  const start = Math.max(0, at - Math.floor(length / 3));
  const end = Math.min(text.length, start + length);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ").trim()}${end < text.length ? "…" : ""}`;
}

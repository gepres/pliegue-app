import { describe, expect, it } from "vitest";

import {
  buildLexicalIndex,
  cosine,
  diversify,
  fuseRankings,
  lexicalScores,
  normalizeVector,
  quantize,
  searchTerms,
  snippetFor,
} from "./semantic-search";

const chunks = [
  "El jardín de senderos que se bifurcan es un laberinto en el tiempo.",
  "La biblioteca de Babel contiene todos los libros posibles.",
  "Un río atraviesa la ciudad; el puente es antiguo.",
  "The garden of forking paths is a labyrinth in time.",
];

describe("recuperar fragmentos (04.4)", () => {
  it("busca sin mayúsculas, sin acentos y sin palabras vacías", () => {
    expect(searchTerms("El JARDÍN de los Senderos")).toEqual(["jardin", "senderos"]);
  });

  it("BM25 pone arriba el fragmento que tiene las palabras", () => {
    const index = buildLexicalIndex(chunks);
    const scores = lexicalScores(index, "jardin laberinto", () => true);
    const best = [...scores.entries()].sort((a, b) => b[1] - a[1])[0];
    expect(best?.[0]).toBe(0);
    expect(scores.has(2)).toBe(false);
  });

  it("el alcance se aplica dentro de la consulta: lo de fuera ni puntúa", () => {
    const index = buildLexicalIndex(chunks);
    const scores = lexicalScores(index, "jardin", (chunk) => chunk !== 0);
    expect(scores.has(0)).toBe(false);
    expect(lexicalScores(index, "jardin", () => false).size).toBe(0);
  });

  it("los vectores en 8 bits conservan el coseno", () => {
    const a = [0.1, 0.9, -0.3, 0.05];
    const b = [0.12, 0.85, -0.25, 0.1];
    const exact = (() => {
      const na = normalizeVector(a);
      const nb = normalizeVector(b);
      return na.reduce((sum, value, index) => sum + value * (nb[index] ?? 0), 0);
    })();
    expect(cosine(normalizeVector(a), quantize(b))).toBeCloseTo(exact, 2);
    expect(cosine(normalizeVector([1, 0]), quantize([1, 0, 0]))).toBe(0);
  });

  it("junta las dos listas por puesto: lo que sale en las dos gana", () => {
    const lexical = new Map([[1, 9], [2, 5], [3, 1]]);
    const semantic = new Map([[2, 0.9], [4, 0.8], [1, 0.1]]);
    const fused = fuseRankings(lexical, semantic);
    expect(fused[0]?.chunk).toBe(2);
    expect(fused.find((hit) => hit.chunk === 4)).toMatchObject({ lexicalRank: null, semanticRank: 2 });
    expect(fused.find((hit) => hit.chunk === 3)).toMatchObject({ lexicalRank: 3, semanticRank: null });
  });

  it("no deja que un libro llene la lista", () => {
    const hits = ["a", "a", "a", "a", "b", "a"].map((document, chunk) => ({ chunk, document }));
    expect(diversify(hits, (hit) => hit.document, 2).map((hit) => hit.chunk)).toEqual([0, 1, 4]);
  });

  it("enseña el trozo donde está la palabra", () => {
    const text = `${"Relleno sin interés. ".repeat(30)}Aquí aparece el jardín del que se habla.`;
    const snippet = snippetFor(text, "jardin", 80);
    expect(snippet).toContain("jardín");
    expect(snippet.startsWith("…")).toBe(true);
  });
});

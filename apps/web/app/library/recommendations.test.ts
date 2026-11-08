import { describe, expect, it } from "vitest";

import {
  emptyTasteProfile,
  librarySignals,
  openLibraryUrl,
  parseCandidates,
  parseTasteProfile,
  rankRecommendations,
  recommendationQueries,
  subjectForGenre,
  type RecommendationQuery,
} from "./recommendations";

const doc = (key: string, title: string, author: string, extra: Record<string, unknown> = {}) => ({ author_name: [author], cover_i: 1, key, ratings_average: 4, ratings_count: 40, title, ...extra });
const subject = (label: string, value: string, source: "declared" | "library" = "declared"): RecommendationQuery => ({ kind: "subject", label, source, value });
const author = (name: string, source: "declared" | "library" = "declared"): RecommendationQuery => ({ kind: "author", label: name, source, value: name });

describe("recomendaciones (06.1)", () => {
  it("lleva los géneros de las fichas a los temas de Open Library", () => {
    expect(subjectForGenre("Novela de ciencia ficción")?.id).toBe("ciencia-ficcion");
    expect(subjectForGenre("Realismo mágico")?.query).toBe("magic realism");
    expect(subjectForGenre("Cuentos fantásticos")?.id).toMatch(/cuento|fantasia/);
    expect(subjectForGenre("Manual técnico")).toBeNull();
  });

  it("de la biblioteca saca los autores y temas que más se repiten; un favorito cuenta doble", () => {
    const signals = librarySignals([
      { authors: ["Julio Cortázar"], favorite: false, genres: ["Cuentos"], title: "Bestiario" },
      { authors: ["Julio Cortázar"], favorite: true, genres: ["Novela", "Realismo mágico"], title: "Rayuela" },
      { authors: ["Jorge Luis Borges"], favorite: false, genres: ["Cuentos"], title: "Ficciones" },
    ]);
    expect(signals.authors[0]).toEqual({ count: 3, name: "Julio Cortázar" });
    expect(signals.subjects.map((item) => item.id)).toEqual(["cuento", "realismo-magico"]);
  });

  it("solo con gustos declarados no usa la biblioteca, aunque haya señales", () => {
    const profile = { ...emptyTasteProfile, authors: ["Isabel Allende"], enabled: true, subjects: ["realismo-magico"] };
    const signals = { authors: [{ count: 3, name: "Julio Cortázar" }], subjects: [{ count: 2, id: "cuento" }] };
    expect(recommendationQueries(profile, signals).map((query) => query.value)).toEqual(["magic realism", "Isabel Allende"]);
    const withLibrary = recommendationQueries({ ...profile, useLibrary: true }, signals);
    expect(withLibrary.map((query) => `${query.value}:${query.source}`)).toEqual(["magic realism:declared", "short stories:library", "Isabel Allende:declared", "Julio Cortázar:library"]);
  });

  it("a Open Library pregunta por tema o autor, en español y por valoración", () => {
    const bySubject = new URL(openLibraryUrl(subject("Realismo mágico", "magic realism")));
    expect(bySubject.searchParams.get("q")).toBe('subject:"magic realism" language:spa');
    expect(bySubject.searchParams.get("sort")).toBe("rating");
    const byAuthor = new URL(openLibraryUrl(author("Julio Cortázar")));
    expect(byAuthor.searchParams.get("author")).toBe("Julio Cortázar");
    expect(byAuthor.searchParams.get("q")).toBe("language:spa");
  });

  it("si el título va en otro alfabeto, enseña el de la edición en español (con su ISBN)", () => {
    const [kafka, cien] = parseCandidates({
      docs: [
        doc("/works/OL1W", "海辺のカフカ", "Haruki Murakami", { editions: { docs: [{ isbn: ["9788483835241"], language: ["spa"], title: "Kafka en la orilla" }] } }),
        doc("/works/OL2W", "Cien años de soledad", "Gabriel García Márquez", { editions: { docs: [{ isbn: ["0060919655"], language: ["eng", "spa"], title: "One hundred years of solitude" }] } }),
        { key: "/authors/OL3A", title: "No es una obra" },
      ],
    });
    expect(kafka).toMatchObject({ isbn: "9788483835241", title: "Kafka en la orilla" });
    expect(cien).toMatchObject({ isbn: null, title: "Cien años de soledad" });
    expect(parseCandidates({ docs: [doc("/works/OL4W", "ノルウェイの森", "Murakami")] })).toEqual([]);
  });

  it("ordena por razones y valoración, quita lo que ya se tiene y lo descartado, y dice por qué", () => {
    const realismo = subject("Realismo mágico", "magic realism");
    const allende = author("Isabel Allende");
    const ranked = rankRecommendations(
      [
        { candidates: parseCandidates({ docs: [doc("/works/A", "La casa de los espíritus", "Isabel Allende"), doc("/works/B", "Cien años de soledad", "Gabriel García Márquez"), doc("/works/C", "Rayuela", "Julio Cortázar"), doc("/works/D", "Pedro Páramo", "Juan Rulfo")] }), query: realismo },
        { candidates: parseCandidates({ docs: [doc("/works/A", "La casa de los espíritus", "Isabel Allende"), doc("/works/E", "Eva Luna", "Isabel Allende"), doc("/works/F", "Paula", "Isabel Allende")] }), query: allende },
      ],
      { dismissed: ["/works/D"], owned: [{ authors: ["Julio Cortázar"], title: "Rayuela" }] },
    );
    expect(ranked[0]).toMatchObject({ key: "/works/A" });
    expect(ranked[0]!.reasons.map((reason) => reason.text)).toEqual(["Porque te interesa: realismo mágico", "De Isabel Allende, que te gusta"]);
    expect(ranked.map((item) => item.key)).not.toContain("/works/C");
    expect(ranked.map((item) => item.key)).not.toContain("/works/D");
    // Como mucho dos de Allende.
    expect(ranked.filter((item) => item.author === "Isabel Allende")).toHaveLength(2);
  });

  it("lee los gustos guardados con cuidado", () => {
    expect(parseTasteProfile(null)).toEqual(emptyTasteProfile);
    expect(parseTasteProfile({ authors: [" Borges ", "Borges", 3], enabled: true, subjects: ["fantasia", "no-existe"], useLibrary: "sí" })).toMatchObject({
      authors: ["Borges"],
      enabled: true,
      subjects: ["fantasia"],
      useLibrary: false,
    });
  });
});

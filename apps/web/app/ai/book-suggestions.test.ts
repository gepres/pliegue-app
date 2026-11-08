import { describe, expect, it } from "vitest";

import { cleanTasteList, createSuggestionsPrompt, parseSuggestions, sameBook } from "./book-suggestions";

describe("afinar con IA (06.1)", () => {
  it("al modelo solo le llegan temas y autores", () => {
    const prompt = createSuggestionsPrompt({ authors: ["Isabel Allende"], subjects: ["Realismo mágico"] });
    expect(prompt).toContain("Temas que le interesan: Realismo mágico.");
    expect(prompt).toContain("Autores que le gustan o que lee: Isabel Allende.");
  });

  it("lee las sugerencias sin repetir ni pasar de 8", () => {
    const many = Array.from({ length: 12 }, (_, index) => ({ author: `Autor ${index}`, reason: "Encaja.", title: `Libro ${index}` }));
    expect(parseSuggestions({ suggestions: many })).toHaveLength(8);
    expect(parseSuggestions({ suggestions: [{ author: "A", reason: "", title: "T" }, { author: "a", reason: "", title: "t" }, { author: "", reason: "", title: "Sin autor" }] })).toHaveLength(1);
    expect(parseSuggestions("nada")).toEqual([]);
  });

  it("una sugerencia vale si Open Library tiene ese título con ese autor", () => {
    expect(sameBook({ author: "Gabriel García Márquez", title: "Cien años de soledad" }, { author: "Gabriel Garcia Marquez", title: "Cien Años de Soledad" })).toBe(true);
    expect(sameBook({ author: "Julio Cortázar", title: "La vuelta al día en ochenta mundos" }, { author: "Julio Verne", title: "La vuelta al día en ochenta mundos" })).toBe(false);
    expect(sameBook({ author: "Isabel Allende", title: "El libro inventado" }, { author: "Isabel Allende", title: "La casa de los espíritus" })).toBe(false);
  });

  it("la ruta acepta listas cortas de textos cortos", () => {
    expect(cleanTasteList(["Borges", " Allende "], 80)).toEqual(["Borges", "Allende"]);
    expect(cleanTasteList(Array.from({ length: 13 }, () => "x"), 80)).toBeNull();
    expect(cleanTasteList(["x".repeat(81)], 80)).toBeNull();
    expect(cleanTasteList("Borges", 80)).toBeNull();
  });
});

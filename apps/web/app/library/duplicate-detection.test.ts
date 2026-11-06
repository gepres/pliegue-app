import { describe, expect, it } from "vitest";

import {
  containment,
  differenceHash,
  differentAuthors,
  differentVolumes,
  findDuplicatePairs,
  hammingDistance,
  normalizeWords,
  textSignature,
  titleSimilarity,
  type DuplicateItem,
} from "./duplicate-detection";

/** Un texto de libro reproducible: frases distintas según la semilla. */
function prose(seed: string, sentences = 200) {
  const words = "alma cuerpo razón deseo virtud ciudad mundo tiempo verdad bien mal dios hombre naturaleza ley orden libertad juicio memoria lenguaje".split(" ");
  let state = [...seed].reduce((sum, character) => sum * 31 + character.charCodeAt(0), 7) >>> 0;
  const next = () => (state = (Math.imul(state, 1103515245) + 12345) >>> 0);
  return Array.from({ length: sentences }, () => Array.from({ length: 12 }, () => words[next() % words.length]).join(" ") + ".").join(" ");
}

const item = (id: string, title: string, extra: Partial<DuplicateItem> = {}): DuplicateItem => ({ id, title, ...extra });

describe("libros repetidos que no son el mismo archivo (03.6)", () => {
  it("normaliza sin tildes ni signos, y las firmas no dependen de saltos ni guiones", () => {
    expect(normalizeWords("¿Qué es la Filosofía? — «Razón»")).toEqual(["que", "es", "la", "filosofia", "razon"]);
    const text = prose("hume");
    const reflowed = text.replace(/\. /g, ".\n\n").replace(/razón/g, "RAZÓN");
    expect(containment(textSignature(text), textSignature(reflowed))).toBe(1);
  });

  it("el EPUB y el PDF del mismo libro: el mismo texto aunque el PDF traiga más al principio", () => {
    const book = prose("sobrenatural");
    const pairs = findDuplicatePairs([
      item("epub", "Sobrenatural", { authors: ["Joe Dispenza"], text: book }),
      item("pdf", "Sobrenatural", { authors: ["Joe Dispenza"], text: `${prose("creditos", 20)} ${book}` }),
      item("otro", "Otro libro", { text: prose("otro") }),
    ]);
    expect(pairs).toEqual([{ ids: ["epub", "pdf"], reason: "text", score: 1 }]);
  });

  it("dos libros distintos no se juntan aunque compartan un prólogo de colección", () => {
    const prologue = prose("coleccion", 15);
    const pairs = findDuplicatePairs([
      item("a", "Kant", { text: `${prologue} ${prose("kant")}` }),
      item("b", "Hegel", { text: `${prologue} ${prose("hegel")}` }),
    ]);
    expect(pairs).toEqual([]);
  });

  it("un escaneo sin texto: por la portada parecida y el título, o por el mismo título y autor", () => {
    const cover = "f0e1d2c3b4a59687";
    const nearCover = "f0e1d2c3b4a59686"; // un bit distinto: el mismo escaneo en grises
    const pairs = findDuplicatePairs([
      item("color", "Las plantas de los dioses", { coverHash: cover }),
      item("grises", "Plantas de los dioses", { coverHash: nearCover, text: prose("plantas") }),
      item("escaneo", "La experiencia interna", { authors: ["Jacobo Grinberg"] }),
      item("texto", "La experiencia interna", { authors: ["Jacobo Grinberg"], coverHash: "0000000000000000", text: prose("experiencia") }),
    ]);
    expect(pairs.map((pair) => [pair.reason, ...pair.ids])).toEqual(
      expect.arrayContaining([
        ["cover", "color", "grises"],
        ["title", "escaneo", "texto"],
      ]),
    );
  });

  it("los frenos: otro tomo, otro idioma, otro autor y las palabras de colección", () => {
    expect(differentVolumes(item("a", "Platón I"), item("b", "Platón II"))).toBe(true);
    expect(differentVolumes(item("a", "Gredos - Platón"), item("b", "Platón I"))).toBe(false);
    expect(differentAuthors(item("a", "x", { authors: ["José María Arguedas"] }), item("b", "y", { authors: ["Mario Vargas Llosa"] }))).toBe(true);

    const book = prose("diario");
    expect(findDuplicatePairs([item("es", "Diario", { language: "es", text: book }), item("en", "Diario", { language: "en", text: book })])).toEqual([]);

    // «Biblioteca Grandes Pensadores Gredos» en muchos títulos no hace parecidos a Platón y Séneca.
    const series = ["Platón", "Séneca", "Hume", "Kant", "Hegel", "Spinoza"].map((name, index) =>
      item(String(index), `${name} (Biblioteca Grandes Pensadores Gredos)`, { coverHash: "aaaaaaaaaaaaaaaa" }),
    );
    expect(findDuplicatePairs(series)).toEqual([]);
    // Con «gredos» como palabra de colección, lo que queda de los dos títulos es «Bruno».
    expect(titleSimilarity(item("a", "Gredos - Bruno"), item("b", "Giordano Bruno"))).toBe(0.5);
    expect(titleSimilarity(item("a", "Gredos - Bruno"), item("b", "Giordano Bruno"), new Set(["gredos"]))).toBe(1);
  });

  it("dHash: un bit por par de píxeles vecinos, y la distancia en bits", () => {
    const gradient = Array.from({ length: 72 }, (_, index) => 255 - (index % 9) * 20);
    expect(differenceHash(gradient)).toBe("ffffffffffffffff");
    expect(hammingDistance("ffffffffffffffff", "fffffffffffffff0")).toBe(4);
  });
});

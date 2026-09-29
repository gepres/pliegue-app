import { describe, expect, it } from "vitest";

import {
  alignSentences,
  blockSpanToLayer,
  foldLetters,
  layerOffsetToBlock,
  layerSpanToBlock,
  locateBlocks,
  pairSentences,
  segmentAt,
  segmentsWithin,
  sentenceSpans,
  type ParallelSegment,
  type TextSpan,
} from "./parallel-text";

const slice = (text: string, span: TextSpan) => text.slice(span.start, span.end);

describe("frases", () => {
  it("parte por frases sin los espacios de los bordes y corta en cada renglón", () => {
    const text = "  The island was empty. Nobody came!  Why?";
    expect(sentenceSpans(text, "en").map((span) => slice(text, span))).toEqual([
      "The island was empty.",
      "Nobody came!",
      "Why?",
    ]);
    const index = "The river valley 12\nA map of the coast 14";
    expect(sentenceSpans(index, "en").map((span) => slice(index, span))).toEqual([
      "The river valley 12",
      "A map of the coast 14",
    ]);
  });

  it("no da frases de un texto vacío", () => {
    expect(sentenceSpans("   ")).toEqual([]);
  });
});

describe("emparejar por longitud", () => {
  it("empareja una a una cuando las frases casan", () => {
    expect(alignSentences([40, 12, 80], [44, 14, 90])).toEqual([
      { source: [0, 1], target: [0, 1] },
      { source: [1, 2], target: [1, 2] },
      { source: [2, 3], target: [2, 3] },
    ]);
  });

  it("junta dos frases cuando la traducción las dio en una", () => {
    // «Mr.» partió el original en dos; la traducción («El señor…») es una sola frase.
    expect(alignSentences([3, 40, 60], [48, 66])).toEqual([
      { source: [0, 2], target: [0, 1] },
      { source: [2, 3], target: [1, 2] },
    ]);
  });

  it("parte una frase en dos cuando la traducción la dio en dos", () => {
    // Un punto y coma del original que el motor convirtió en punto.
    expect(alignSentences([120, 50], [58, 70, 56])).toEqual([
      { source: [0, 1], target: [0, 2] },
      { source: [1, 2], target: [2, 3] },
    ]);
  });

  it("empareja el bloque entero si un lado está vacío de frases o es enorme", () => {
    expect(alignSentences([], [10])).toEqual([]);
    const many = Array.from({ length: 250 }, () => 20);
    expect(alignSentences(many, many)).toEqual([{ source: [0, 250], target: [0, 250] }]);
  });

  it("devuelve tramos del texto que empiezan y acaban en cada frase", () => {
    const source = "The island was empty. It had been so for years. Nobody knew why.";
    const target = "La isla estaba vacía. Lo había estado durante años. Nadie sabía por qué.";
    const pairs = pairSentences(source, target, { source: "en", target: "es" });
    expect(pairs.map((pair) => [slice(source, pair.source), slice(target, pair.target)])).toEqual([
      ["The island was empty.", "La isla estaba vacía."],
      ["It had been so for years.", "Lo había estado durante años."],
      ["Nobody knew why.", "Nadie sabía por qué."],
    ]);
  });

  it("con una sola frase en un lado, el bloque entero es una pareja", () => {
    const source = "First part. Second part.";
    const target = "Todo en una frase";
    expect(pairSentences(source, target)).toEqual([{ source: { end: source.length, start: 0 }, target: { end: 17, start: 0 } }]);
    expect(pairSentences("", target)).toEqual([]);
  });

  it("encuentra la pareja de una posición y las que toca una selección", () => {
    const segments: ParallelSegment[] = [
      { source: { end: 10, start: 0 }, target: { end: 12, start: 0 } },
      { source: { end: 25, start: 11 }, target: { end: 30, start: 13 } },
    ];
    expect(segmentAt(segments, "source", 4)).toBe(0);
    expect(segmentAt(segments, "target", 20)).toBe(1);
    // En el espacio entre dos frases cuenta la que acaba de terminar.
    expect(segmentAt(segments, "source", 10)).toBe(0);
    expect(segmentAt([], "source", 3)).toBe(-1);
    expect(segmentsWithin(segments, "target", { end: 14, start: 5 })).toEqual([0, 1]);
    expect(segmentsWithin(segments, "source", { end: 25, start: 20 })).toEqual([1]);
  });
});

describe("el bloque dentro de la capa de texto del PDF", () => {
  it("pliega a letras y cifras: sin guiones, tildes, espacios ni ligaduras", () => {
    expect(foldLetters("Conoci-\nmiento, «ﬁn» 12").folded).toBe("conocimientofin12");
    expect(foldLetters("Canción").folded).toBe("cancion");
  });

  it("casa el texto del bloque con la capa aunque las palabras partidas estén unidas", () => {
    const layerText = "Capítulo 1El conoci-miento del mar. Era otro día.Nota 1";
    const blockText = "El conocimiento del mar. Era otro día.";
    const layer = foldLetters(layerText);
    const block = foldLetters(blockText);
    const [at = -1] = locateBlocks(layer, [block]);
    expect(at).toBeGreaterThan(0);

    // La segunda frase del bloque, llevada a la capa.
    const second = { end: blockText.length, start: blockText.indexOf("Era") };
    const mapped = blockSpanToLayer(block, layer, at, second);
    expect(mapped && layerText.slice(mapped.start, mapped.end)).toBe("Era otro día");

    // «miento», tras el guion en la capa, es del bloque y de su primera frase.
    const offset = layerOffsetToBlock(block, layer, at, layerText.indexOf("miento"));
    expect(offset).toBe(blockText.indexOf("miento"));
    // El punto final cuenta con la frase que cierra; lo de fuera del bloque, no.
    expect(layerOffsetToBlock(block, layer, at, layerText.indexOf("mar.") + 3)).toBe(blockText.indexOf("mar") + 2);
    expect(layerOffsetToBlock(block, layer, at, layerText.indexOf("Nota") + 1)).toBeNull();

    // Una selección que empieza antes del bloque y acaba en «otro».
    const selection = { end: layerText.indexOf("otro") + 4, start: 2 };
    const within = layerSpanToBlock(block, layer, at, selection);
    expect(within && blockText.slice(within.start, within.end)).toBe("El conocimiento del mar. Era otro");
  });

  it("desempata un texto repetido por el orden de los bloques", () => {
    const layer = foldLetters("12 El mar 12 La costa 12");
    const blocks = ["El mar", "12", "La costa"].map(foldLetters);
    expect(locateBlocks(layer, blocks)).toEqual([2, 7, 9]);
    expect(locateBlocks(layer, [foldLetters("No está"), foldLetters("")])).toEqual([-1, -1]);
  });
});

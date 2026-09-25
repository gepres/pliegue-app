import { describe, expect, it } from "vitest";

import {
  countWords,
  coverCrop,
  defaultPostcardDesign,
  fitText,
  isLongQuote,
  postcardFileName,
  postcardShareText,
  shortQuoteWords,
  shortenQuote,
  wrapText,
  type PostcardContent,
} from "./postcard-model";

/** Cada carácter mide medio cuerpo: basta para comprobar la maquetación sin navegador. */
const measure = (text: string, fontSize: number) => text.length * fontSize * 0.5;

const content: PostcardContent = {
  author: "Adolfo Bioy Casares",
  image: null,
  page: 12,
  quote: "Hoy, en esta isla, ha ocurrido un milagro.",
  title: "La invención de Morel",
};

describe("maquetación de la cita", () => {
  it("parte en renglones sin pasar del ancho", () => {
    const lines = wrapText(measure, "uno dos tres cuatro cinco seis", 10, 60);
    // 60 de ancho a cinco por carácter: doce caracteres por renglón, espacios incluidos.
    expect(lines).toEqual(["uno dos tres", "cuatro cinco", "seis"]);
    for (const line of lines) expect(measure(line, 10)).toBeLessThanOrEqual(60);
  });

  it("corta una palabra que no cabe sola", () => {
    expect(wrapText(measure, "supercalifragilístico", 10, 50)).toEqual(["supercalif", "ragilístic", "o"]);
  });

  it("elige el cuerpo más grande con el que cabe", () => {
    const fitted = fitText(measure, content.quote, { height: 300, width: 600 }, { lineHeight: 1.3, maxSize: 80, minSize: 20 });
    expect(fitted.truncated).toBe(false);
    expect(fitted.lines.length * fitted.lineHeight).toBeLessThanOrEqual(300);
    // Dos puntos más ya no caben.
    const bigger = wrapText(measure, content.quote, fitted.fontSize + 2, 600);
    expect(bigger.length * (fitted.fontSize + 2) * 1.3).toBeGreaterThan(300);
  });

  it("si ni al mínimo cabe, recorta y termina en puntos suspensivos", () => {
    const fitted = fitText(measure, "palabra ".repeat(200), { height: 100, width: 300 }, { lineHeight: 1.3, maxSize: 60, minSize: 20 });
    expect(fitted.truncated).toBe(true);
    expect(fitted.fontSize).toBe(20);
    expect(fitted.lines.at(-1)?.endsWith("…")).toBe(true);
    expect(fitted.lines.length * fitted.lineHeight).toBeLessThanOrEqual(100);
  });
});

describe("encaje de la imagen", () => {
  it("cubre el hueco y respeta el punto focal", () => {
    const crop = coverCrop({ height: 1000, width: 2000 }, { height: 500, width: 500 }, { x: 1, y: 0.5 });
    expect(crop.sw).toBe(1000);
    expect(crop.sh).toBe(1000);
    // Con el foco en el borde derecho se toma el final de la imagen, sin salirse.
    expect(crop.sx).toBe(1000);
    expect(coverCrop({ height: 1000, width: 2000 }, { height: 500, width: 500 }, { x: 0, y: 0.5 }).sx).toBe(0);
  });
});

describe("derechos y referencia", () => {
  it("avisa de una cita larga y la acorta a una cita breve", () => {
    const long = "palabra ".repeat(shortQuoteWords + 10);
    expect(isLongQuote(long)).toBe(true);
    const short = shortenQuote(long);
    expect(countWords(short)).toBe(shortQuoteWords);
    expect(short.endsWith("…")).toBe(true);
    expect(isLongQuote(content.quote)).toBe(false);
  });

  it("comparte la cita con su referencia completa", () => {
    const design = defaultPostcardDesign(content);
    expect(postcardShareText(content, design)).toBe(
      "“Hoy, en esta isla, ha ocurrido un milagro.”\n— Adolfo Bioy Casares, «La invención de Morel», p. 12",
    );
  });

  it("nombra el archivo con el título y la página", () => {
    expect(postcardFileName(content)).toBe("postal-la-invencion-de-morel-p12.png");
  });

  it("empieza con la plantilla recordada y muestra lo que hay", () => {
    const design = defaultPostcardDesign({ ...content, image: new Blob(["x"]) }, { format: "story", template: "tinta" });
    expect(design.template).toBe("tinta");
    expect(design.format).toBe("story");
    expect(design.showImage).toBe(true);
    expect(design.showQuote).toBe(true);
    expect(design.showPage).toBe(true);
  });
});

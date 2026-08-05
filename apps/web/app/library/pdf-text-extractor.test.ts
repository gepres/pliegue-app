import { describe, expect, it } from "vitest";

import { createTestPdf as pdf } from "./pdf-test-fixture";
import { extractPdfText, joinPdfPages, maxPdfInputBytes } from "./pdf-text-extractor";

describe("extracción local de texto en PDF", () => {
  it("extrae el texto de cada página conservando su número", async () => {
    const result = await extractPdfText(
      pdf(["Hallazgo principal del corpus", "Segunda pagina con contexto"]),
    );

    expect(result.pageCount).toBe(2);
    expect(result.truncated).toBe(false);
    expect(result.pages).toEqual([
      { number: 1, text: "Hallazgo principal del corpus" },
      { number: 2, text: "Segunda pagina con contexto" },
    ]);
    expect(joinPdfPages(result.pages)).toBe(
      "Hallazgo principal del corpus\n\nSegunda pagina con contexto",
    );
  });

  it("omite las páginas sin capa de texto y declara el total real", async () => {
    const result = await extractPdfText(pdf([null, "Solo esta pagina tiene texto", null]));

    expect(result.pageCount).toBe(3);
    expect(result.pages).toEqual([{ number: 2, text: "Solo esta pagina tiene texto" }]);
  });

  it("deja el resultado vacío cuando ninguna página tiene capa de texto", async () => {
    const result = await extractPdfText(pdf([null, null]));

    expect(result.pages).toEqual([]);
    expect(result.pageCount).toBe(2);
  });

  it("corta por número de páginas y por caracteres marcando el recorte", async () => {
    const byPage = await extractPdfText(pdf(["Primera", "Segunda", "Tercera"]), {
      maxPages: 2,
    });

    expect(byPage.pages.map((page) => page.number)).toEqual([1, 2]);
    expect(byPage.pageCount).toBe(3);
    expect(byPage.truncated).toBe(true);

    const byCharacter = await extractPdfText(pdf(["Primera pagina", "Segunda pagina"]), {
      maxCharacters: 20,
    });

    expect(byCharacter.truncated).toBe(true);
    // El tope se aplica al texto extraído, sin contar el separador entre páginas.
    expect(
      byCharacter.pages.reduce((total, page) => total + page.text.length, 0),
    ).toBe(20);
    expect(byCharacter.pages[0]?.text).toBe("Primera pagina");
  });

  it("rechaza archivos dañados y los que superan el límite de tamaño", async () => {
    await expect(extractPdfText(new Blob(["no es un pdf"]))).rejects.toThrow(
      /dañado|PDF válido/,
    );

    const oversized = {
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      size: maxPdfInputBytes + 1,
    } as Blob;

    await expect(extractPdfText(oversized)).rejects.toThrow(/50 MB/);
  });
});

// @vitest-environment node
import "fake-indexeddb/auto";

import { describe, expect, it } from "vitest";

import type { OcrPageLayout } from "./ocr-layout";
import { countDocumentsOcr, readOcrPage, readOcrSearchTexts, removeDocumentsOcr, saveOcrPage } from "./ocr-page-store";

const layout = (text: string): OcrPageLayout => ({
  blocks: [{ box: { height: 0.1, width: 0.8, x: 0.1, y: 0.1 }, centered: false, confidence: 90, kind: "paragraph", lineHeight: 0.014, lines: 3, text }],
  confidence: 90,
  prose: false,
  words: text.split(" ").length,
});

describe("las páginas leídas con OCR, guardadas en el navegador (03.5b)", () => {
  it("guarda y devuelve lo leído de cada página, solo con los mismos idiomas", async () => {
    expect(await readOcrPage("libro", 3, "spa")).toBeNull();
    await saveOcrPage("libro", 3, "spa", layout("La página tres."));
    await saveOcrPage("libro", 4, "spa", layout("La página cuatro."));
    expect((await readOcrPage("libro", 3, "spa"))?.blocks[0]?.text).toBe("La página tres.");
    // Leída con otro idioma: hay que leerla de nuevo.
    expect(await readOcrPage("libro", 3, "eng+spa")).toBeNull();
    // Volver a leerla la sustituye.
    await saveOcrPage("libro", 3, "eng+spa", layout("Otra lectura."));
    expect((await readOcrPage("libro", 3, "eng+spa"))?.blocks[0]?.text).toBe("Otra lectura.");
  });

  it("cuenta y borra solo lo de esos documentos", async () => {
    await saveOcrPage("otro", 1, "eng", layout("Otro libro."));
    expect(await countDocumentsOcr(["libro", "sin-nada"])).toBe(2);
    expect(await removeDocumentsOcr(["libro", "sin-nada"])).toBe(2);
    expect(await countDocumentsOcr(["libro"])).toBe(0);
    expect(await readOcrPage("otro", 1, "eng")).not.toBeNull();
  });

  it("junta lo leído de cada documento, en orden de página, para buscarlo (03.4)", async () => {
    await saveOcrPage("buscar", 2, "spa", layout("segunda página."));
    await saveOcrPage("buscar", 1, "spa", layout("Primera página."));
    const texts = await readOcrSearchTexts();
    expect(texts.get("buscar")).toBe("Primera página. segunda página.");
  });
});

import { describe, expect, it } from "vitest";

import { cleanOcrText, ocrLanguages } from "./ocr";

describe("OCR en el equipo (03.5)", () => {
  it("lee con el idioma del libro; sin él, con inglés y español", () => {
    expect(ocrLanguages("es")).toBe("spa");
    expect(ocrLanguages("en-GB")).toBe("eng");
    expect(ocrLanguages("PT")).toBe("por");
    expect(ocrLanguages("de")).toBe("deu");
    expect(ocrLanguages("ja")).toBe("eng+spa");
    expect(ocrLanguages(null)).toBe("eng+spa");
  });

  it("une los renglones de cada párrafo, junta las palabras cortadas y separa los párrafos", () => {
    const raw = "The land of Mu was a vast con-\ntinent in the Pacific,\nwith no mountains.\n\n  MAP OF MU  \n\nThe Troano\r\nManuscript says so.\n";
    expect(cleanOcrText(raw)).toBe(
      "The land of Mu was a vast continent in the Pacific, with no mountains.\n\nMAP OF MU\n\nThe Troano Manuscript says so.",
    );
  });

  it("un guion entre palabras que no es corte de renglón se queda", () => {
    expect(cleanOcrText("a well-known\nstory")).toBe("a well-known story");
    expect(cleanOcrText("Fin del capítulo -\n12")).toBe("Fin del capítulo - 12");
  });

  it("sin texto reconocible, vacío", () => {
    expect(cleanOcrText("  \n \n\n ")).toBe("");
  });
});

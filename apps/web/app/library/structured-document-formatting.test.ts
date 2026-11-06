import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { extractStructuredDocument, inlineRuns, maxArchiveInputBytes, type StructuredDocumentBlock } from "./structured-document-extractor";

function archive(entries: Record<string, string>) {
  return new Blob([zipSync(Object.fromEntries(Object.entries(entries).map(([name, content]) => [name, strToU8(content)])))]);
}

const paragraphs = (blocks: readonly StructuredDocumentBlock[]) => blocks.filter((block) => block.kind === "paragraph");

describe("negrita y cursiva de EPUB y DOCX, solo en el original (05.1)", () => {
  it("EPUB: em, i, strong y b, anidados y con espacios dentro de la etiqueta; el texto no cambia", async () => {
    const result = await extractStructuredDocument(
      "epub",
      archive({
        "META-INF/container.xml": `<container><rootfiles><rootfile full-path="c.opf" /></rootfiles></container>`,
        "c.opf": `<package><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml" /></manifest><spine><itemref idref="a" /></spine></package>`,
        "a.xhtml": `<html><body>
          <h1>Capítulo</h1>
          <p>La palabra <em> saudade</em> es <strong>casi <i>intraducible</i></strong>, dicen.</p>
          <p>Un párrafo sin formato.</p>
          <ul><li><b>Uno</b> y dos</li></ul>
          <figure><figcaption><i>Figura 1.</i> El jardín.</figcaption></figure>
        </body></html>`,
      }),
    );
    const [first, plain, item, caption] = paragraphs(result.sections[0]!.blocks);
    expect(first).toEqual({
      kind: "paragraph",
      runs: [
        { text: "La palabra " },
        { italic: true, text: "saudade" },
        { text: " es " },
        { bold: true, text: "casi " },
        { bold: true, italic: true, text: "intraducible" },
        { text: ", dicen." },
      ],
      text: "La palabra saudade es casi intraducible, dicen.",
    });
    expect(plain).toEqual({ kind: "paragraph", text: "Un párrafo sin formato." });
    expect(item).toEqual({ kind: "paragraph", runs: [{ text: "• " }, { bold: true, text: "Uno" }, { text: " y dos" }], text: "• Uno y dos" });
    expect(caption).toEqual({ caption: true, kind: "paragraph", runs: [{ italic: true, text: "Figura 1." }, { text: " El jardín." }], text: "Figura 1. El jardín." });
  });

  it("DOCX: w:b y w:i por run; w:b w:val=\"0\" no es negrita; la viñeta va aparte", async () => {
    const result = await extractStructuredDocument(
      "docx",
      archive({
        "word/document.xml": `<w:document><w:body>
          <w:p><w:r><w:t xml:space="preserve">Texto </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>importante</w:t></w:r><w:r><w:rPr><w:b w:val="0"/><w:i/></w:rPr><w:t xml:space="preserve"> y en cursiva</w:t></w:r><w:r><w:t>.</w:t></w:r></w:p>
          <w:p><w:pPr><w:numPr /></w:pPr><w:r><w:rPr><w:i w:val="true"/></w:rPr><w:t>Punto</w:t></w:r></w:p>
          <w:p><w:r><w:rPr><w:b w:val="false"/></w:rPr><w:t>Sin formato</w:t></w:r></w:p>
        </w:body></w:document>`,
      }),
    );
    expect(result.sections[0]!.blocks).toEqual([
      {
        kind: "paragraph",
        runs: [{ text: "Texto " }, { bold: true, text: "importante" }, { italic: true, text: " y en cursiva" }, { text: "." }],
        text: "Texto importante y en cursiva.",
      },
      { kind: "paragraph", runs: [{ text: "• " }, { italic: true, text: "Punto" }], text: "• Punto" },
      { kind: "paragraph", text: "Sin formato" },
    ]);
  });

  it("si los tramos no dan exactamente el texto, no hay tramos: el párrafo se pinta como siempre", () => {
    const on = String.fromCharCode(0xe000);
    const off = String.fromCharCode(0xe001);
    expect(inlineRuns(`a ${on}b${off} c`, "a b c")).toEqual([{ text: "a " }, { italic: true, text: "b" }, { text: " c" }]);
    expect(inlineRuns(`a ${on}b${off} c`, "a  b c")).toBeUndefined();
    expect(inlineRuns("sin marcas", "sin marcas")).toBeUndefined();
  });

  it("el tope de EPUB y DOCX es de 150 MB", () => {
    expect(maxArchiveInputBytes).toBe(150 * 1024 * 1024);
  });
});

import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import {
  extractStructuredDocument,
  maxArchiveEntryBytes,
} from "./structured-document-extractor";

function archive(entries: Record<string, string>) {
  return new Blob([
    zipSync(
      Object.fromEntries(
        Object.entries(entries).map(([name, content]) => [name, strToU8(content)]),
      ),
    ),
  ]);
}

describe("extracción local de documentos estructurados", () => {
  it("extrae títulos, párrafos y listas de DOCX", async () => {
    const result = await extractStructuredDocument(
      "docx",
      archive({
        "word/document.xml": `
          <w:document xmlns:w="word"><w:body>
            <w:p><w:pPr><w:pStyle w:val="Heading1" /></w:pPr><w:r><w:t>Resumen &amp; método</w:t></w:r></w:p>
            <w:p><w:r><w:t>Primera idea</w:t></w:r><w:r><w:tab /></w:r><w:r><w:t>con contexto.</w:t></w:r></w:p>
            <w:p><w:pPr><w:numPr /></w:pPr><w:r><w:t>Hallazgo local</w:t></w:r></w:p>
          </w:body></w:document>`,
      }),
    );

    expect(result.truncated).toBe(false);
    expect(result.sections[0]?.blocks).toEqual([
      { kind: "heading", level: 1, text: "Resumen & método" },
      { kind: "paragraph", text: "Primera idea\tcon contexto." },
      { kind: "paragraph", text: "• Hallazgo local" },
    ]);
  });

  it("respeta el orden de lectura declarado por un EPUB", async () => {
    const result = await extractStructuredDocument(
      "epub",
      archive({
        "META-INF/container.xml": `<container><rootfiles><rootfile full-path="OPS/content.opf" /></rootfiles></container>`,
        "OPS/content.opf": `
          <package><manifest>
            <item id="second" href="chapters/02.xhtml" media-type="application/xhtml+xml" />
            <item id="first" href="chapters/01.xhtml" media-type="application/xhtml+xml" />
          </manifest><spine><itemref idref="first" /><itemref idref="second" /></spine></package>`,
        "OPS/chapters/01.xhtml": `<html><body><h1>Entrada</h1><p>Primera sección.</p><script>alert(1)</script></body></html>`,
        "OPS/chapters/02.xhtml": `<html><body><h2>Salida</h2><p>Segunda sección.</p></body></html>`,
      }),
    );

    expect(result.sections.map((section) => section.title)).toEqual(["Entrada", "Salida"]);
    expect(result.sections[0]?.blocks).toContainEqual({
      kind: "paragraph",
      text: "Primera sección.",
    });
    expect(JSON.stringify(result)).not.toContain("alert(1)");
  });

  it("ordena diapositivas PPTX por su número", async () => {
    const result = await extractStructuredDocument(
      "pptx",
      archive({
        "ppt/slides/slide2.xml": `<p:sld><a:p><a:r><a:t>Segundo bloque</a:t></a:r></a:p></p:sld>`,
        "ppt/slides/slide1.xml": `<p:sld><a:p><a:r><a:t>Portada</a:t></a:r></a:p><a:p><a:r><a:t>Contexto</a:t></a:r></a:p></p:sld>`,
      }),
    );

    expect(result.sections.map((section) => section.label)).toEqual([
      "Diapositiva 1",
      "Diapositiva 2",
    ]);
    expect(result.sections[0]?.blocks[0]).toEqual({
      kind: "heading",
      level: 2,
      text: "Portada",
    });
  });

  it("reconstruye filas XLSX con shared strings y nombres de hoja", async () => {
    const result = await extractStructuredDocument(
      "xlsx",
      archive({
        "xl/sharedStrings.xml": `<sst><si><t>Hallazgo</t></si><si><t>Prioridad</t></si></sst>`,
        "xl/workbook.xml": `<workbook><sheets><sheet name="Matriz" r:id="rId1" /></sheets></workbook>`,
        "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml" /></Relationships>`,
        "xl/worksheets/sheet1.xml": `<worksheet><sheetData>
          <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
          <row r="2"><c r="A2" t="inlineStr"><is><t>Lectura local</t></is></c><c r="B2"><v>3</v></c></row>
        </sheetData></worksheet>`,
      }),
    );

    expect(result.sections[0]?.title).toBe("Matriz");
    expect(result.sections[0]?.blocks[0]).toEqual({
      kind: "table",
      rows: [
        ["Hallazgo", "Prioridad"],
        ["Lectura local", "3"],
      ],
    });
  });

  it("rechaza archivos dañados y entradas que exceden límites seguros", async () => {
    await expect(
      extractStructuredDocument("docx", new Blob(["no es un zip"])),
    ).rejects.toThrow(/dañado|ZIP válido/);

    const oversizedXml = `<w:document><w:p><w:t>${"a".repeat(maxArchiveEntryBytes + 1)}</w:t></w:p></w:document>`;
    await expect(
      extractStructuredDocument("docx", archive({ "word/document.xml": oversizedXml })),
    ).rejects.toThrow(/límites seguros/);
  });
});

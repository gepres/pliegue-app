import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { blockHasText, extractStructuredDocument, type StructuredDocumentBlock } from "./structured-document-extractor";

/** Unos bytes de «imagen»: al extractor solo le importan la ruta, el tipo y el tamaño. */
const picture = (size: number, fill: number) => new Uint8Array(size).fill(fill);

function archive(entries: Record<string, string | Uint8Array>) {
  return new Blob([
    zipSync(Object.fromEntries(Object.entries(entries).map(([name, content]) => [name, typeof content === "string" ? strToU8(content) : content]))),
  ]);
}

/** Lo que interesa de cada bloque para compararlo: de una imagen, su alt, tipo y tamaño. */
async function describe_(blocks: readonly StructuredDocumentBlock[]) {
  return Promise.all(
    blocks.map(async (block) =>
      block.kind === "image"
        ? { alt: block.alt, bytes: (await block.image.arrayBuffer()).byteLength, first: new Uint8Array(await block.image.arrayBuffer())[0], kind: "image", type: block.image.type }
        : block,
    ),
  );
}

describe("imágenes de EPUB y DOCX en el lector (05.1)", () => {
  it("EPUB: la portada en SVG, las ilustraciones con su alt y su pie, en su sitio", async () => {
    const result = await extractStructuredDocument(
      "epub",
      archive({
        "META-INF/container.xml": `<container><rootfiles><rootfile full-path="OPS/content.opf" /></rootfiles></container>`,
        "OPS/content.opf": `
          <package><manifest>
            <item id="cover" href="text/cover.xhtml" media-type="application/xhtml+xml" />
            <item id="ch1" href="text/ch1.xhtml" media-type="application/xhtml+xml" />
          </manifest><spine><itemref idref="cover" /><itemref idref="ch1" /></spine></package>`,
        "OPS/text/cover.xhtml": `<html><body><svg xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="../images/cover.jpg" /></svg></body></html>`,
        "OPS/text/ch1.xhtml": `<html><body>
          <h1>El jardín</h1>
          <p><img src="../images/ornamento.png" alt="adorno" /></p>
          <p>Primer párrafo.</p>
          <figure><img src="../images/mapa%20del%20jardin.png" alt="Mapa del jardín" /><figcaption>Figura 1. El jardín.</figcaption></figure>
          <p><img src="https://ejemplo.org/fuera.png" alt="fuera" /><img src="data:image/png;base64,AAAA" alt="incrustada" />Texto con imágenes de fuera.</p>
        </body></html>`,
        "OPS/images/cover.jpg": picture(2_000, 1),
        "OPS/images/ornamento.png": picture(120, 2),
        "OPS/images/mapa del jardin.png": picture(5_000, 3),
        "OPS/images/dibujo.svg": strToU8(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`),
      }),
    );

    expect(await describe_(result.sections[0]!.blocks)).toEqual([{ alt: "", bytes: 2_000, first: 1, kind: "image", type: "image/jpeg" }]);
    expect(await describe_(result.sections[1]!.blocks)).toEqual([
      { kind: "heading", level: 1, text: "El jardín" },
      // El adorno de 120 bytes no pasa; lo de fuera (http:, data:) no se pide.
      { kind: "paragraph", text: "Primer párrafo." },
      { alt: "Mapa del jardín", bytes: 5_000, first: 3, kind: "image", type: "image/png" },
      { caption: true, kind: "paragraph", text: "Figura 1. El jardín." },
      { kind: "paragraph", text: "Texto con imágenes de fuera." },
    ]);
    // Una sección que es solo la portada no tiene texto, pero se queda: es la portada.
    expect(result.sections).toHaveLength(2);
    expect(result.sections[1]!.blocks.filter(blockHasText).map((block) => block.text)).not.toContain("adorno");
  });

  it("DOCX: la imagen de un párrafo por su relación, con su descripción; la externa no", async () => {
    const result = await extractStructuredDocument(
      "docx",
      archive({
        "word/document.xml": `
          <w:document><w:body>
            <w:p><w:r><w:t>Antes de la figura.</w:t></w:r></w:p>
            <w:p><w:r><w:drawing><wp:inline><wp:docPr id="1" name="Imagen 1" descr="Gráfico de ventas" />
              <a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rId5" /></pic:blipFill></pic:pic></a:graphicData></a:graphic>
            </wp:inline></w:drawing></w:r></w:p>
            <w:p><w:r><w:drawing><wp:inline><wp:docPr id="2" name="Enlazada" /><a:blip r:embed="rId9" /></wp:inline></w:drawing></w:r><w:r><w:t>Con una imagen enlazada fuera.</w:t></w:r></w:p>
          </w:body></w:document>`,
        "word/_rels/document.xml.rels": `<Relationships>
            <Relationship Id="rId5" Type="image" Target="media/image1.png" />
            <Relationship Id="rId9" Type="image" Target="https://ejemplo.org/x.png" TargetMode="External" />
          </Relationships>`,
        "word/media/image1.png": picture(3_000, 7),
      }),
    );

    expect(await describe_(result.sections[0]!.blocks)).toEqual([
      { kind: "paragraph", text: "Antes de la figura." },
      { alt: "Gráfico de ventas", bytes: 3_000, first: 7, kind: "image", type: "image/png" },
      { kind: "paragraph", text: "Con una imagen enlazada fuera." },
    ]);
  });

  it("los bloques con texto son los que se traducen; tablas e imágenes, no", () => {
    expect(blockHasText({ kind: "paragraph", text: "a" })).toBe(true);
    expect(blockHasText({ kind: "heading", level: 2, text: "b" })).toBe(true);
    expect(blockHasText({ kind: "table", rows: [["c"]] })).toBe(false);
    expect(blockHasText({ alt: "", image: new Blob([]), kind: "image" })).toBe(false);
  });
});

import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import {
  createDocumentCover,
  findEpubCoverPath,
  fitCoverSize,
  readEpubCoverImage,
} from "./document-cover";

const container =
  '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>';

function epub(opf: string, files: Record<string, Uint8Array> = {}) {
  const archive = zipSync({
    mimetype: strToU8("application/epub+zip"),
    "META-INF/container.xml": strToU8(container),
    "OEBPS/content.opf": strToU8(opf),
    ...files,
  });
  return new Blob([archive.slice()]);
}

describe("fitCoverSize", () => {
  it("encaja la página en 300 × 450 conservando la proporción", () => {
    expect(fitCoverSize(612, 792, true)).toEqual({ height: 388, width: 300 });
    expect(fitCoverSize(900, 600, true)).toEqual({ height: 200, width: 300 });
  });

  it("no amplía una imagen pequeña salvo que se pida", () => {
    expect(fitCoverSize(120, 180, false)).toEqual({ height: 180, width: 120 });
    expect(fitCoverSize(120, 180, true)).toEqual({ height: 450, width: 300 });
  });
});

describe("findEpubCoverPath", () => {
  it("prefiere la portada que declara EPUB 3", () => {
    const opf =
      '<manifest><item id="img1" href="images/otra.jpg" media-type="image/jpeg"/><item properties="cover-image" id="c" href="images/portada.jpg" media-type="image/jpeg"/></manifest>';
    expect(findEpubCoverPath(opf, "OEBPS/content.opf")).toBe("OEBPS/images/portada.jpg");
  });

  it("sigue el meta de EPUB 2 aunque traiga los atributos en otro orden", () => {
    const opf =
      '<metadata><meta content="cubierta" name="cover"/></metadata><manifest><item href="../Images/Cubierta%20A.png" id="cubierta" media-type="image/png"/></manifest>';
    expect(findEpubCoverPath(opf, "OEBPS/Text/content.opf")).toBe("OEBPS/Images/Cubierta A.png");
  });

  it("sin declaración, toma la imagen que se llama cover o portada", () => {
    const opf =
      '<manifest><item id="a" href="a.jpg" media-type="image/jpeg"/><item id="b" href="img/cover.jpeg" media-type="image/jpeg"/></manifest>';
    expect(findEpubCoverPath(opf, "content.opf")).toBe("img/cover.jpeg");
  });

  it("no devuelve nada si el EPUB no trae imágenes", () => {
    const opf = '<manifest><item id="t" href="t.xhtml" media-type="application/xhtml+xml"/></manifest>';
    expect(findEpubCoverPath(opf, "content.opf")).toBeNull();
  });
});

describe("readEpubCoverImage", () => {
  it("saca solo la imagen de portada, con su tipo", async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const opf =
      '<package><metadata><meta name="cover" content="portada"/></metadata><manifest><item id="portada" href="images/cover.jpg" media-type="image/jpeg"/></manifest></package>';

    const image = await readEpubCoverImage(epub(opf, { "OEBPS/images/cover.jpg": jpeg }));

    expect(image?.type).toBe("image/jpeg");
    expect(new Uint8Array((await image?.arrayBuffer()) ?? new ArrayBuffer(0))).toEqual(jpeg);
  });

  it("no devuelve nada si la portada declarada no está dentro del archivo", async () => {
    const opf =
      '<manifest><item properties="cover-image" id="c" href="falta.png" media-type="image/png"/></manifest>';
    await expect(readEpubCoverImage(epub(opf))).resolves.toBeNull();
  });
});

describe("createDocumentCover", () => {
  it("sin canvas —las pruebas corren en Node— no inventa una portada", async () => {
    await expect(createDocumentCover("pdf", new Blob(["%PDF-1.4"]))).resolves.toBeNull();
    await expect(createDocumentCover("txt", new Blob(["texto"]))).resolves.toBeNull();
  });
});

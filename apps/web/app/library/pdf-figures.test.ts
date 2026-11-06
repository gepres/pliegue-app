import { beforeAll, describe, expect, it } from "vitest";

import {
  figureCaptions,
  imageBoxes,
  pageFigures,
  placeFigures,
  readPageFigures,
  readPageImages,
  scanBox,
  type FigureOps,
} from "./pdf-figures";
import { loadPdfjs, openPdfDocument } from "./pdf-runtime";
import { pdfjsWarmUpTimeout, warmUpPdfjs } from "./pdf-test-fixture";

const ops: FigureOps = {
  paintFormXObjectBegin: 74,
  paintFormXObjectEnd: 75,
  paintImageMaskXObject: 83,
  paintImageXObject: 85,
  paintInlineImageXObject: 86,
  restore: 11,
  save: 10,
  transform: 12,
};

const page = { bottom: 0, left: 0, right: 612, top: 792 };

describe("las imágenes de una página de PDF (05.6)", () => {
  it("sigue la matriz vigente: q/Q, cm y la de cada formulario", () => {
    const boxes = imageBoxes(
      [10, 12, 85, 11, 74, 10, 12, 85, 11, 75, 85],
      [
        null,
        [300, 0, 0, 200, 100, 400],
        ["img1"],
        null,
        [[1, 0, 0, 1, 50, 50], [0, 0, 100, 100]],
        null,
        [100, 0, 0, 80, 10, 20],
        ["img2"],
        null,
        null,
        ["img3"],
      ],
      ops,
    );
    expect(boxes).toEqual([
      { bottom: 400, left: 100, right: 400, top: 600 },
      // Dentro del formulario: su matriz desplaza 50 y 50.
      { bottom: 70, left: 60, right: 160, top: 150 },
      // Tras cerrar el formulario y el `q`, vuelve la identidad: el cuadrado unidad.
      { bottom: 0, left: 0, right: 1, top: 1 },
    ]);
  });

  it("una imagen girada ocupa la caja de sus cuatro esquinas", () => {
    const [box] = imageBoxes([12, 85], [[0, 100, -200, 0, 300, 300], ["img"]], ops);
    expect(box).toEqual({ bottom: 300, left: 100, right: 300, top: 400 });
  });

  it("deja fuera adornos y el fondo de un escaneo, y funde las franjas de una ilustración", () => {
    const figures = pageFigures(
      [
        { bottom: 0, left: 0, right: 612, top: 792 }, // el escaneo de la página
        { bottom: 700, left: 40, right: 60, top: 720 }, // una viñeta
        { bottom: 300, left: 300, right: 560, top: 304 }, // un filete
        { bottom: 400, left: 100, right: 400, top: 500 }, // mitad de abajo de un grabado…
        { bottom: 500, left: 100, right: 400, top: 600 }, // …y mitad de arriba
        { bottom: 100, left: 80, right: 200, top: 220 }, // otra figura, más abajo
      ],
      page,
    );
    expect(figures).toEqual([
      { bottom: 400, left: 100, right: 400, top: 600 },
      { bottom: 100, left: 80, right: 200, top: 220 },
    ]);
  });

  it("deja fuera las cenefas de cabecera y de pie que se repiten en cada página", () => {
    const bands = pageFigures(
      [
        { bottom: 0, left: 120, right: 489, top: 65 }, // cenefa al pie, de 369×65
        { bottom: 730, left: 100, right: 512, top: 790 }, // cabecera
        { bottom: 640, left: 200, right: 340, top: 720 }, // un logotipo en la portadilla: se queda
      ],
      page,
    );
    expect(bands).toEqual([{ bottom: 640, left: 200, right: 340, top: 720 }]);
  });

  it("cada figura va delante del primer párrafo de su columna que queda por debajo", () => {
    const block = (top: number, left = 72, right = 540) => ({ box: { bottom: top - 40, left, right, top }, text: "Un párrafo." });
    const blocks = [block(740), block(690), block(330), block(280)];
    const slots = (figure: { bottom: number; left: number; right: number; top: number }, list = blocks) =>
      placeFigures([figure], list).map(({ slot }) => slot);
    expect(slots({ bottom: 400, left: 100, right: 400, top: 600 })).toEqual([2]);
    // Al pie de la página: detrás de todo.
    expect(slots({ bottom: 60, left: 100, right: 400, top: 200 })).toEqual([4]);

    // A dos columnas, la figura de la derecha no se mete entre los párrafos de la izquierda.
    const twoColumns = [block(740, 72, 300), block(400, 72, 300), block(740, 320, 540), block(300, 320, 540)];
    expect(slots({ bottom: 450, left: 330, right: 530, top: 650 }, twoColumns)).toEqual([3]);
  });

  it("no repite el texto: fuera la imagen que lleva encima la mitad del texto de la página", () => {
    const prose = "Texto que ya se lee recompuesto en la columna de lectura. ".repeat(8);
    const blocks = [
      { box: { bottom: 600, left: 80, right: 520, top: 700 }, text: prose },
      { box: { bottom: 200, left: 80, right: 520, top: 300 }, text: "Un pie corto." },
    ];
    // El fondo de un recuadro con el párrafo encima: se lee el texto, no su foto.
    expect(placeFigures([{ bottom: 580, left: 60, right: 540, top: 720 }], blocks)).toEqual([]);
    // Un mapa con un rótulo corto encima sí se queda, detrás del rótulo.
    expect(placeFigures([{ bottom: 150, left: 60, right: 540, top: 350 }], blocks)).toEqual([
      { box: { bottom: 150, left: 60, right: 540, top: 350 }, slot: 2 },
    ]);
  });

  it("el escaneo de una página (una historieta, un libro sin OCR) es la imagen que la cubre casi entera", () => {
    // Desborda un poco la página, como suele: se recorta a la parte visible.
    expect(
      scanBox(
        [
          { bottom: 400, left: 100, right: 400, top: 600 },
          { bottom: -6, left: -4, right: 616, top: 798 },
        ],
        page,
      ),
    ).toEqual({ bottom: 0, left: 0, right: 612, top: 792 });
    // Con márgenes blancos alrededor, si cubre al menos tres cuartos, también.
    expect(scanBox([{ bottom: 40, left: 30, right: 582, top: 752 }], page)).toEqual({ bottom: 40, left: 30, right: 582, top: 752 });
    // Una ilustración grande no es el escaneo, ni lo es una página sin imágenes.
    expect(scanBox([{ bottom: 200, left: 72, right: 540, top: 700 }], page)).toBeNull();
    expect(scanBox([], page)).toBeNull();
  });

  describe("el pie de cada figura (03.5b)", () => {
    // Cuerpo de 11 puntos; una figura de 300×200 a media página.
    const figure = { bottom: 400, left: 150, right: 450, top: 600 };
    const body = (top: number, text = "Texto del libro que sigue y sigue con la explicación del capítulo. ".repeat(6)) => ({
      box: { bottom: top - 80, left: 72, right: 540, top },
      centered: false,
      fontHeight: 11,
      lines: 6,
      text,
    });
    const line = (top: number, text: string, { fontHeight = 9, left = 150, right = 450, centered = false } = {}) => ({
      box: { bottom: top - fontHeight * 1.2, left, right, top },
      centered,
      fontHeight,
      lines: 1,
      text,
    });
    const captionsOf = (blocks: Parameters<typeof figureCaptions>[1], slot: number) => [...figureCaptions([{ box: figure, slot }], blocks, page)];

    it("el renglón de letra menor pegado debajo de la figura (Freud, p. 11)", () => {
      const blocks = [body(720), line(392, "Detalles del mundo onírico de Salvador Dalí (1904-1989)."), body(360)];
      expect(captionsOf(blocks, 1)).toEqual([1]);
    });

    it("el que se anuncia, aunque vaya en el cuerpo del libro («FIGURA 7.»), y también encima", () => {
      expect(captionsOf([body(720), line(380, "FIGURA 7. La acumulación de hábitos.", { fontHeight: 11 }), body(340)], 1)).toEqual([1]);
      // Encima solo si se anuncia («Figura 3»): una frase suelta encima es el texto que la presenta.
      expect(captionsOf([body(720), line(615, "Figura 3. Mapa de las rutas.", { fontHeight: 11 }), body(380)], 2)).toEqual([1]);
      expect(captionsOf([body(720), line(615, "Una frase suelta encima.", { fontHeight: 9 }), body(380)], 2)).toEqual([]);
    });

    it("no toma por pie el párrafo que sigue, un folio, una cabecera ni lo que queda lejos", () => {
      // El párrafo siguiente, en el cuerpo del libro.
      expect(captionsOf([body(720), body(390)], 1)).toEqual([]);
      // Un folio, solo cifras.
      expect(captionsOf([body(720), line(392, "18 19")], 1)).toEqual([]);
      // Lejos: a más de tres renglones y medio.
      expect(captionsOf([body(720), line(340, "Detalles del mundo onírico."), body(300)], 1)).toEqual([]);
      // A un lado, sin compartir el ancho de la figura.
      expect(captionsOf([body(720), line(392, "Nota al margen.", { left: 470, right: 560 })], 1)).toEqual([]);
      // En el margen de abajo de la página: la cabecera de una revista («24• Pianist 75»).
      const low = { bottom: 60, left: 150, right: 450, top: 260 };
      expect([...figureCaptions([{ box: low, slot: 1 }], [body(720), line(40, "24• Pianist 75")], page)]).toEqual([]);
    });
  });

  describe("con pdf.js y un PDF de verdad", () => {
    beforeAll(warmUpPdfjs, pdfjsWarmUpTimeout);

    it("encuentra el grabado y el del formulario, sin la viñeta ni el escaneo", async () => {
      const pdfjs = await loadPdfjs();
      const { close, document } = await openPdfDocument(imagePdf(), "text");
      try {
        const first = await document.getPage(1);
        const figures = await readPageFigures(first, pdfjs.OPS);
        expect(figures).toEqual([
          { bottom: 400, left: 100, right: 400, top: 600 },
          { bottom: 120, left: 300, right: 500, top: 270 },
        ]);
        // El escaneo queda aparte, para cuando la página no tiene texto que recomponer.
        expect((await readPageImages(first, pdfjs.OPS)).scan).toEqual({ bottom: 0, left: 0, right: 612, top: 792 });
      } finally {
        await close();
      }
    });
  });
});

/**
 * Un PDF con texto y cuatro imágenes de 2×2: un grabado de 300×200, el mismo dentro de un
 * formulario desplazado, una viñeta de 12×12 y el «escaneo» que cubre la página.
 */
function imagePdf() {
  // Bytes por debajo de 128: el generador escribe texto y el codificador los deja como están.
  const pixels = String.fromCharCode(16, 32, 48, 64, 80, 96, 112, 16, 32, 48, 64, 80);
  const image = `<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${pixels.length} >>\nstream\n${pixels}\nendstream`;
  const formStream = "q 200 0 0 150 0 0 cm /Im1 Do Q";
  const form = `<< /Type /XObject /Subtype /Form /BBox [0 0 612 792] /Resources << /XObject << /Im1 4 0 R >> >> /Matrix [1 0 0 1 300 120] /Length ${formStream.length} >>\nstream\n${formStream}\nendstream`;
  const content = [
    "q 612 0 0 792 0 0 cm /Im1 Do Q",
    "BT /F1 18 Tf 72 720 Td (Capitulo uno) Tj ET",
    "q 300 0 0 200 100 400 cm /Im1 Do Q",
    "q 12 0 0 12 60 700 cm /Im1 Do Q",
    "/Fm1 Do",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [6 0 R] /Count 1 >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    image,
    form,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> /XObject << /Im1 4 0 R /Fm1 5 0 R >> >> /Contents 7 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];

  let body = "%PDF-1.7\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

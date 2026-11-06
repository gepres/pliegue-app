/**
 * Las imágenes de una página de PDF y dónde caen entre sus párrafos (05.6).
 *
 * El modo Lectura recompone solo el texto: sin esto, las ilustraciones, los mapas y los
 * gráficos de un libro se perdían al leerlo así o al leer su traducción. Aquí se sacan las
 * cajas de las imágenes de la lista de operaciones de pdf.js —la misma que usa para dibujar la
 * página, sin dibujarla— y se decide entre qué bloques de texto va cada una. Se hace al
 * recomponer la página, que ocurre por delante de donde se lee: al llegar, la imagen ya tiene
 * su hueco y se está dibujando.
 *
 * Todo en el espacio de usuario del PDF (la `y` hacia arriba), el mismo de los fragmentos de
 * texto de `pdf-reflow`.
 */

export interface FigureBox {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

/** Los códigos de operación de pdf.js que importan aquí (`pdfjs.OPS`). */
export interface FigureOps {
  paintFormXObjectBegin: number;
  paintFormXObjectEnd: number;
  paintImageMaskXObject: number;
  paintImageXObject: number;
  paintInlineImageXObject: number;
  restore: number;
  save: number;
  transform: number;
}

type Matrix = readonly [number, number, number, number, number, number];

const identity: Matrix = [1, 0, 0, 1, 0, 0];

/** `m1 · m2`, como hace el canvas al aplicar una transformación sobre la vigente. */
function multiply(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function asMatrix(value: unknown): Matrix | null {
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) return null;
  const numbers = Array.from(value as ArrayLike<unknown>);
  if (numbers.length !== 6 || !numbers.every((part) => typeof part === "number" && Number.isFinite(part))) return null;
  return numbers as unknown as Matrix;
}

/** Una imagen se pinta en el cuadrado unidad de su espacio: su caja es la de sus cuatro esquinas. */
function unitSquare(matrix: Matrix): FigureBox {
  const corners = [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ].map(([x = 0, y = 0]) => [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]] as const);
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  return { bottom: Math.min(...ys), left: Math.min(...xs), right: Math.max(...xs), top: Math.max(...ys) };
}

/**
 * Las cajas de todas las imágenes que pinta la página, recorriendo sus operaciones con la
 * matriz vigente: `q`/`Q`, `cm` y los formularios, que traen la suya.
 */
export function imageBoxes(fnArray: ArrayLike<number>, argsArray: ArrayLike<unknown>, ops: FigureOps): FigureBox[] {
  const images = new Set([ops.paintImageXObject, ops.paintInlineImageXObject, ops.paintImageMaskXObject]);
  const stack: Matrix[] = [];
  let current = identity;
  const boxes: FigureBox[] = [];

  for (let index = 0; index < fnArray.length; index += 1) {
    const fn = fnArray[index];
    const args = argsArray[index] as unknown[] | null | undefined;
    if (fn === ops.save) {
      stack.push(current);
    } else if (fn === ops.restore) {
      current = stack.pop() ?? identity;
    } else if (fn === ops.transform) {
      const matrix = asMatrix(args);
      if (matrix) current = multiply(current, matrix);
    } else if (fn === ops.paintFormXObjectBegin) {
      // Un formulario se dibuja como un `q … Q` con su propia matriz.
      stack.push(current);
      const matrix = asMatrix(args?.[0]);
      if (matrix) current = multiply(current, matrix);
    } else if (fn === ops.paintFormXObjectEnd) {
      current = stack.pop() ?? identity;
    } else if (fn !== undefined && images.has(fn)) {
      boxes.push(unitSquare(current));
    }
  }

  return boxes;
}

const area = (box: FigureBox) => Math.max(0, box.right - box.left) * Math.max(0, box.top - box.bottom);

/** Se tocan o se pisan, con un margen: una ilustración partida en franjas es una sola. */
function touching(a: FigureBox, b: FigureBox, gap: number) {
  return a.left <= b.right + gap && b.left <= a.right + gap && a.bottom <= b.top + gap && b.bottom <= a.top + gap;
}

/** Lado mínimo de una figura, en puntos: medio centímetro largo. Lo más pequeño es adorno. */
const minimumSide = 36;
/** Y una superficie mínima de la página, para dejar fuera filetes, viñetas y capitulares. */
const minimumShare = 0.015;
/** Lo que cubre casi toda la página es el escaneo o un fondo, no una ilustración. */
const backgroundShare = 0.75;
/** El margen de arriba y el de abajo, donde van las cenefas de cabecera y de pie. */
const marginShare = 0.1;
/** Y lo bajas que son esas cenefas, en proporción del alto de la página. */
const bandShare = 0.12;

/**
 * Las figuras que merece la pena enseñar al leer, ordenadas de arriba abajo. Fuera quedan los
 * adornos —viñetas, filetes y las cenefas que se repiten arriba o abajo de cada página— y el
 * fondo de un escaneo; las imágenes contiguas se funden en una. `view` es la caja visible de
 * la página en el espacio del PDF (`page.view` de pdf.js).
 */
export function pageFigures(boxes: readonly FigureBox[], view: FigureBox) {
  const width = Math.max(1, view.right - view.left);
  const height = Math.max(1, view.top - view.bottom);
  const pageArea = width * height;
  let figures = boxes.filter((box) => area(box) < pageArea * backgroundShare);

  let merged = true;
  while (merged) {
    merged = false;
    const next: FigureBox[] = [];
    for (const box of figures) {
      const neighbour = next.findIndex((other) => touching(other, box, 2));
      if (neighbour === -1) {
        next.push(box);
        continue;
      }
      const other = next[neighbour]!;
      next[neighbour] = {
        bottom: Math.min(other.bottom, box.bottom),
        left: Math.min(other.left, box.left),
        right: Math.max(other.right, box.right),
        top: Math.max(other.top, box.top),
      };
      merged = true;
    }
    figures = next;
  }

  const band = (box: FigureBox) =>
    box.top - box.bottom < height * bandShare &&
    (box.bottom >= view.top - height * marginShare || box.top <= view.bottom + height * marginShare);

  return figures
    .filter(
      (box) =>
        box.right - box.left >= minimumSide &&
        box.top - box.bottom >= minimumSide &&
        area(box) >= pageArea * minimumShare &&
        area(box) < pageArea * backgroundShare &&
        !band(box),
    )
    .sort((a, b) => b.top - a.top || a.left - b.left);
}

/** Lo que hace falta de una página de pdf.js para buscarle las figuras. */
export interface FigureSource {
  getOperatorList: () => Promise<{ argsArray: unknown[]; fnArray: ArrayLike<number> }>;
  /** Caja visible de la página: `[x1, y1, x2, y2]` en el espacio del PDF. */
  view: readonly number[];
}

/**
 * La imagen que cubre casi toda la página —el escaneo de un libro sin capa de texto, la viñeta a
 * página completa de una historieta—, recortada a la parte visible; `null` si no la hay.
 * `pageFigures` la deja fuera por ser el fondo, pero en una página sin texto es la página misma.
 */
export function scanBox(boxes: readonly FigureBox[], view: FigureBox): FigureBox | null {
  const pageArea = Math.max(1, view.right - view.left) * Math.max(1, view.top - view.bottom);
  const largest = [...boxes].sort((a, b) => area(b) - area(a))[0];
  if (!largest || area(largest) < pageArea * backgroundShare) return null;
  return {
    bottom: Math.max(view.bottom, largest.bottom),
    left: Math.max(view.left, largest.left),
    right: Math.min(view.right, largest.right),
    top: Math.min(view.top, largest.top),
  };
}

/** Las figuras de una página y su escaneo, si lo tiene, leídos de sus operaciones y sin dibujarla. */
export async function readPageImages(page: FigureSource, ops: FigureOps) {
  const [left = 0, bottom = 0, right = 0, top = 0] = page.view;
  const view = { bottom, left, right, top };
  const { argsArray, fnArray } = await page.getOperatorList();
  const boxes = imageBoxes(fnArray, argsArray, ops);
  return { figures: pageFigures(boxes, view), scan: scanBox(boxes, view) };
}

/** Las figuras de una página, leídas de sus operaciones y sin dibujarla. */
export async function readPageFigures(page: FigureSource, ops: FigureOps) {
  return (await readPageImages(page, ops)).figures;
}

const centerInside = (inner: FigureBox, outer: FigureBox) => {
  const x = (inner.left + inner.right) / 2;
  const y = (inner.top + inner.bottom) / 2;
  return x > outer.left && x < outer.right && y > outer.bottom && y < outer.top;
};

/** Con este texto encima, la imagen es el fondo de un recuadro o el escaneo de la página. */
const textUnderneath = 300;

/**
 * Dónde va cada figura entre los bloques de texto de la página, en el orden de lectura: delante
 * del primero que queda por debajo de ella y comparte columna; si ninguno, al final. `slot` es
 * cuántos bloques la preceden.
 *
 * Fuera quedan las imágenes que llevan encima la mitad o más del texto de la página: son el
 * fondo de un recuadro o un escaneo con su capa de texto. Su recorte repetiría ese texto, que ya
 * se lee recompuesto.
 */
export function placeFigures(figures: readonly FigureBox[], blocks: readonly { box: FigureBox; text: string }[]) {
  const pageText = blocks.reduce((sum, block) => sum + block.text.length, 0);
  return figures
    .filter((figure) => {
      const inside = blocks.filter(({ box }) => centerInside(box, figure)).reduce((sum, block) => sum + block.text.length, 0);
      return inside < textUnderneath || inside < pageText * 0.5;
    })
    .map((figure) => {
      const middle = (figure.top + figure.bottom) / 2;
      const index = blocks.findIndex(({ box }) => {
        const sameColumn = Math.min(box.right, figure.right) - Math.max(box.left, figure.left) > 0;
        return sameColumn && (box.top + box.bottom) / 2 < middle;
      });
      return { box: figure, slot: index === -1 ? blocks.length : index };
    });
}

/** Lo que hace falta de un bloque de texto para saber si es el pie de una figura. */
export interface CaptionCandidate {
  box: FigureBox;
  centered: boolean;
  fontHeight: number;
  lines: number;
  text: string;
}

/** Cómo empieza un pie que se anuncia: «Figura 3.», «Fig. 2», «Lámina IV», «Mapa 1»… */
const captionLead =
  /^(fig(ura|ure)?s?\.?|l[áa]m(ina)?s?\.?|ilustraci[óo]n|imagen|foto(graf[íi]a)?|mapa|gr[áa]fico|cuadro|esquema|diagrama|plate|illustration|map|photo)(\s|\.|$)/iu;
/** Lo de los márgenes de arriba y de abajo es la cabecera o el folio, no un pie. */
const runningBand = 0.06;

/**
 * Los pies de figura de una página (03.5b): el índice de cada bloque que es el pie de una de
 * las figuras ya colocadas. Un pie va pegado a su figura —debajo, a menos de tres renglones y
 * medio, o encima si se anuncia—, comparte su ancho o va centrado, es corto y, o va en letra más
 * pequeña que el cuerpo, o empieza como pie («Figura 3.»). Se prefiere dejar escapar un pie a
 * tomar por pie un párrafo del libro.
 *
 * Probado sobre 462 figuras de 89 libros del corpus: reconoce 73, entre ellas las de Freud
 * («Detalles del mundo onírico de Salvador Dalí…»), «FIGURA 7.» de Hábitos atómicos o
 * «Fig. 6.» de los Cuentos filosóficos, sin tomar por pie ni los folios ni el cuerpo.
 */
export function figureCaptions(
  placed: readonly { box: FigureBox; slot: number }[],
  blocks: readonly CaptionCandidate[],
  view: FigureBox,
): Set<number> {
  const captions = new Set<number>();
  if (!blocks.length) return captions;
  // El cuerpo de la página: el de la mayor parte de su texto.
  const sizes = blocks.flatMap((block) => Array<number>(Math.max(1, Math.round(block.text.length / 50))).fill(block.fontHeight)).sort((a, b) => a - b);
  const body = sizes[Math.floor(sizes.length / 2)] || 1;
  const height = Math.max(1, view.top - view.bottom);

  const isCaption = (block: CaptionCandidate | undefined, figure: FigureBox, below: boolean) => {
    if (!block) return false;
    const text = block.text.trim();
    if (!text || /^[\d\s.,·•\-–—]+$/u.test(text) || text.length > 450 || block.lines > 8) return false;
    if (block.box.top > view.top - height * runningBand || block.box.bottom < view.bottom + height * runningBand) return false;
    if (block.fontHeight > body * 1.05) return false;
    const gap = below ? figure.bottom - block.box.top : block.box.bottom - figure.top;
    if (gap < -0.6 * body || gap > (below ? 3.5 : 2.5) * body) return false;
    const overlap = Math.max(0, Math.min(block.box.right, figure.right) - Math.max(block.box.left, figure.left));
    if (overlap < 0.4 * Math.max(1, block.box.right - block.box.left) && !block.centered) return false;
    const announced = captionLead.test(text);
    // Encima solo si se anuncia: lo de encima suele ser el párrafo que la presenta.
    return below ? announced || block.fontHeight <= body * 0.95 : announced;
  };

  for (const { box, slot } of placed) {
    if (!captions.has(slot) && isCaption(blocks[slot], box, true)) captions.add(slot);
    else if (slot > 0 && !captions.has(slot - 1) && isCaption(blocks[slot - 1], box, false)) captions.add(slot - 1);
  }
  return captions;
}

/**
 * La aritmética del visor de PDF, separada del componente para poder comprobarla sin un
 * navegador delante: qué escala aplica, dónde cae cada página en la columna, cuál se está
 * leyendo y qué porcentaje de avance representa.
 *
 * El visor dibuja solo las páginas cercanas a la ventana, así que necesita conocer la
 * altura de todas *antes* de dibujar ninguna. De ahí que la disposición se calcule aquí a
 * partir de los tamaños que pdf.js declara, y no del alto real de los elementos.
 */

/** Separación vertical entre páginas, en píxeles CSS. */
export const pageGap = 20;

/**
 * Escalas del control de zoom, además de «ajustar al ancho». Cubren todo el rango hasta los
 * dos extremos para que pulsar repetidamente termine en un número redondo: sin el 0,25 y el
 * 4 en la lista, el respaldo proporcional dejaba escalones sueltos por el camino —40 %, 32 %—
 * antes de tocar el tope.
 */
export const zoomSteps = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4] as const;

export const minScale = 0.25;
export const maxScale = 4;

export interface PdfPageSize {
  /** Alto en puntos PDF, ya rotado. */
  height: number;
  /** Ancho en puntos PDF, ya rotado. */
  width: number;
}

export interface PdfPagePlacement {
  height: number;
  /** Número de página, empezando en 1. */
  number: number;
  top: number;
  width: number;
}

export function clampScale(scale: number) {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(maxScale, Math.max(minScale, scale));
}

/**
 * Escala que hace que la página más ancha del documento quepa justo en el espacio
 * disponible. Se mide contra la más ancha y no contra la primera: en un documento con una
 * lámina apaisada suelta, ajustar por la primera dejaría esa lámina desbordando la columna.
 */
export function fitToWidthScale(sizes: readonly PdfPageSize[], availableWidth: number) {
  const widest = sizes.reduce((max, size) => Math.max(max, size.width), 0);
  if (widest <= 0 || availableWidth <= 0) return 1;
  return clampScale(availableWidth / widest);
}

/** Coloca las páginas en una columna vertical, apiladas con la separación estándar. */
export function placePages(
  sizes: readonly PdfPageSize[],
  scale: number,
  gap = pageGap,
): PdfPagePlacement[] {
  const placements: PdfPagePlacement[] = [];
  let top = 0;

  sizes.forEach((size, index) => {
    const height = Math.round(size.height * scale);
    placements.push({
      height,
      number: index + 1,
      top,
      width: Math.round(size.width * scale),
    });
    top += height + gap;
  });

  return placements;
}

/** Alto total de la columna, sin la separación sobrante bajo la última página. */
export function totalHeight(placements: readonly PdfPagePlacement[]) {
  const last = placements.at(-1);
  return last ? last.top + last.height : 0;
}

function overlap(placement: PdfPagePlacement, viewTop: number, viewBottom: number) {
  return (
    Math.min(placement.top + placement.height, viewBottom) - Math.max(placement.top, viewTop)
  );
}

/**
 * Páginas que conviene tener dibujadas: las que se ven, más `overscan` a cada lado para que
 * al desplazarse no aparezca un hueco en blanco antes de que el canvas esté listo.
 */
export function visiblePageRange(
  placements: readonly PdfPagePlacement[],
  scrollTop: number,
  viewportHeight: number,
  overscan = 1,
): { first: number; last: number } {
  if (placements.length === 0) return { first: 0, last: -1 };

  const viewTop = scrollTop;
  const viewBottom = scrollTop + viewportHeight;
  let first = -1;
  let last = -1;

  placements.forEach((placement, index) => {
    if (overlap(placement, viewTop, viewBottom) > 0) {
      if (first === -1) first = index;
      last = index;
    }
  });

  // Ventana por encima de la primera página o por debajo de la última: se ancla al extremo
  // más cercano en vez de no dibujar nada.
  if (first === -1) {
    const anchor = viewBottom <= 0 ? 0 : placements.length - 1;
    first = anchor;
    last = anchor;
  }

  return {
    first: Math.max(0, first - overscan),
    last: Math.min(placements.length - 1, last + overscan),
  };
}

/**
 * Página que se está leyendo: la que ocupa más superficie de la ventana. Empatar por altura
 * visible es lo que hace que el número no salte de ida y vuelta mientras se pasa de una a
 * otra, como ocurriría midiendo solo dónde cae el borde superior.
 */
export function currentPageNumber(
  placements: readonly PdfPagePlacement[],
  scrollTop: number,
  viewportHeight: number,
) {
  if (placements.length === 0) return 0;

  const viewTop = scrollTop;
  const viewBottom = scrollTop + viewportHeight;
  let best = placements[0]!;
  let bestOverlap = Number.NEGATIVE_INFINITY;

  for (const placement of placements) {
    const visible = overlap(placement, viewTop, viewBottom);
    if (visible > bestOverlap) {
      bestOverlap = visible;
      best = placement;
    }
  }

  return best.number;
}

/** Desplazamiento que deja el borde superior de una página en lo alto de la ventana. */
export function scrollTopForPage(
  placements: readonly PdfPagePlacement[],
  pageNumber: number,
  gap = pageGap,
) {
  const placement = placements[pageNumber - 1];
  if (!placement) return 0;
  return Math.max(0, placement.top - gap);
}

/**
 * Avance de lectura, contado en páginas terminadas: estar en la última significa haber
 * llegado al final. Es la única medida que un lector puede comprobar de un vistazo, y la
 * que hace que «78 %» no aparezca nunca en la página 1 de 49.
 */
export function pageProgressPercent(pageNumber: number, pageCount: number) {
  if (pageCount <= 0 || pageNumber <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((pageNumber / pageCount) * 100)));
}

/** Inversa de `pageProgressPercent`, para retomar la lectura donde se dejó. */
export function pageFromProgressPercent(percent: number, pageCount: number) {
  if (pageCount <= 0) return 1;
  if (!Number.isFinite(percent) || percent <= 0) return 1;
  const page = Math.round((percent / 100) * pageCount);
  return Math.min(pageCount, Math.max(1, page));
}

/**
 * Multiplicador con el que se dibuja el canvas para que el texto no salga borroso en una
 * pantalla de densidad alta, con un techo que evita reservar cientos de megas por página.
 */
export function canvasOutputScale(devicePixelRatio: number, scale: number) {
  const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  // Por encima de 2× la ganancia visible es mínima y la memoria crece al cuadrado; a partir
  // de un zoom grande, además, el propio aumento ya aporta la nitidez.
  const ceiling = scale >= 2 ? 1.5 : 2;
  return Math.min(ceiling, ratio);
}

/** Siguiente escala del control de zoom en la dirección pedida. */
export function nextZoomStep(current: number, direction: "in" | "out") {
  if (direction === "in") {
    const next = zoomSteps.find((step) => step > current + 0.001);
    return clampScale(next ?? current * 1.25);
  }

  const previous = [...zoomSteps].reverse().find((step) => step < current - 0.001);
  return clampScale(previous ?? current / 1.25);
}

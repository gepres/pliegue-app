import { describe, expect, it } from "vitest";

import {
  canvasOutputScale,
  currentPageNumber,
  fitToWidthScale,
  nextZoomStep,
  pageFromProgressPercent,
  pageGap,
  pageProgressPercent,
  placePages,
  scrollTopForPage,
  totalHeight,
  visiblePageRange,
  type PdfPageSize,
} from "./pdf-page-layout";

/** Carta vertical, que es lo que produce el generador de PDF de prueba. */
const letter: PdfPageSize = { height: 792, width: 612 };
const landscape: PdfPageSize = { height: 612, width: 792 };

function uniformSizes(count: number) {
  return Array.from({ length: count }, () => letter);
}

describe("disposición de páginas del visor", () => {
  it("apila las páginas con separación y declara el alto total sin sobrante final", () => {
    const placements = placePages(uniformSizes(3), 1);

    expect(placements.map((page) => page.top)).toEqual([0, 792 + pageGap, (792 + pageGap) * 2]);
    expect(placements.map((page) => page.number)).toEqual([1, 2, 3]);
    // Tres páginas y solo dos separaciones: bajo la última no cuelga espacio de más.
    expect(totalHeight(placements)).toBe(792 * 3 + pageGap * 2);
  });

  it("ajusta al ancho midiendo la página más ancha, no la primera", () => {
    // Un documento con una lámina apaisada suelta: ajustar por la primera la dejaría
    // desbordando la columna.
    const scale = fitToWidthScale([letter, landscape, letter], 792);

    expect(scale).toBeCloseTo(1, 5);
    expect(placePages([letter, landscape], scale)[1]?.width).toBe(792);
  });

  it("mantiene la escala dentro de sus límites y sobrevive a un ancho todavía sin medir", () => {
    expect(fitToWidthScale([letter], 0)).toBe(1);
    expect(fitToWidthScale([], 800)).toBe(1);
    expect(fitToWidthScale([letter], 12_000)).toBe(4);
    expect(fitToWidthScale([letter], 10)).toBe(0.25);
  });
});

describe("qué páginas conviene dibujar", () => {
  const placements = placePages(uniformSizes(10), 1);

  it("dibuja las visibles más un margen a cada lado", () => {
    // Ventana de 800 px arriba del todo: la página 1 ocupa [0, 792) y la 2 aún no asoma
    // —empieza en 812—, así que la 2 entra solo como margen.
    expect(visiblePageRange(placements, 0, 800)).toEqual({ first: 0, last: 1 });

    // Ventana alta que sí abarca dos páginas: el margen las rodea a ambas.
    expect(visiblePageRange(placements, 0, 1000)).toEqual({ first: 0, last: 2 });

    // A mitad del documento el margen se aplica por los dos lados.
    const middle = placements[4]!.top;
    expect(visiblePageRange(placements, middle, 400)).toEqual({ first: 3, last: 5 });
  });

  it("no se sale del documento en los extremos", () => {
    expect(visiblePageRange(placements, 0, 200).first).toBe(0);

    const end = totalHeight(placements);
    expect(visiblePageRange(placements, end - 100, 200).last).toBe(9);
  });

  it("se ancla al extremo más cercano cuando la ventana queda fuera de toda página", () => {
    expect(visiblePageRange(placements, -5000, 100)).toEqual({ first: 0, last: 1 });
    expect(visiblePageRange(placements, 99_999, 100)).toEqual({ first: 8, last: 9 });
  });

  it("devuelve un rango vacío sin páginas", () => {
    expect(visiblePageRange([], 0, 800)).toEqual({ first: 0, last: -1 });
  });
});

describe("página que se está leyendo", () => {
  const placements = placePages(uniformSizes(5), 1);

  it("elige la que ocupa más ventana, no la que asoma por arriba", () => {
    const second = placements[1]!;
    // La ventana empieza 100 px antes de la página 2: la 1 aporta 100 px y la 2 aporta 700.
    expect(currentPageNumber(placements, second.top - 100, 800)).toBe(2);
    // Y al revés: si de la 2 solo asoman 50 px, se sigue leyendo la 1.
    expect(currentPageNumber(placements, second.top - 750, 800)).toBe(1);
  });

  it("no se queda sin respuesta con el documento vacío", () => {
    expect(currentPageNumber([], 0, 800)).toBe(0);
  });

  it("lleva el desplazamiento al inicio de una página concreta", () => {
    expect(scrollTopForPage(placements, 1)).toBe(0);
    expect(scrollTopForPage(placements, 3)).toBe(placements[2]!.top - pageGap);
    // Una página que no existe no debe empujar el visor a un sitio arbitrario.
    expect(scrollTopForPage(placements, 99)).toBe(0);
  });
});

describe("avance de lectura contado en páginas", () => {
  it("no inventa avance en la primera página ni se queda corto en la última", () => {
    // El defecto que motivó todo esto: «78 % leído» con el visor en la página 1 de 49.
    expect(pageProgressPercent(1, 49)).toBe(2);
    expect(pageProgressPercent(12, 49)).toBe(24);
    expect(pageProgressPercent(49, 49)).toBe(100);
  });

  it("va y vuelve entre porcentaje y página sin desplazar la posición guardada", () => {
    for (const page of [1, 12, 25, 48, 49]) {
      const percent = pageProgressPercent(page, 49);
      expect(pageFromProgressPercent(percent, 49)).toBe(page);
    }
  });

  it("trata los valores imposibles sin romperse", () => {
    expect(pageProgressPercent(0, 0)).toBe(0);
    expect(pageProgressPercent(5, 0)).toBe(0);
    expect(pageFromProgressPercent(0, 10)).toBe(1);
    expect(pageFromProgressPercent(Number.NaN, 10)).toBe(1);
    expect(pageFromProgressPercent(500, 10)).toBe(10);
    expect(pageFromProgressPercent(50, 0)).toBe(1);
  });
});

describe("nitidez y zoom", () => {
  it("dibuja a la densidad de la pantalla, con techo para no agotar la memoria", () => {
    expect(canvasOutputScale(1, 1)).toBe(1);
    expect(canvasOutputScale(2, 1)).toBe(2);
    expect(canvasOutputScale(3, 1)).toBe(2);
    // Con zoom alto el propio aumento ya aporta nitidez: el techo baja para que un canvas
    // de una página grande no se dispare.
    expect(canvasOutputScale(3, 2)).toBe(1.5);
    expect(canvasOutputScale(Number.NaN, 1)).toBe(1);
  });

  it("recorre los pasos de zoom y se detiene en los límites", () => {
    expect(nextZoomStep(1, "in")).toBe(1.25);
    expect(nextZoomStep(1, "out")).toBe(0.75);
    // Desde una escala intermedia —la de «ajustar al ancho»— salta al paso contiguo.
    expect(nextZoomStep(0.83, "in")).toBe(1);
    expect(nextZoomStep(0.83, "out")).toBe(0.75);
    expect(nextZoomStep(4, "in")).toBe(4);
    expect(nextZoomStep(0.25, "out")).toBe(0.25);
  });

  it("baja hasta el mínimo por escalones redondos, sin valores sueltos", () => {
    // Pulsar «reducir» varias veces seguidas debe recorrer la escala y parar en el tope,
    // no dejar por el camino un 40 % salido del respaldo proporcional.
    const steps: number[] = [];
    let scale = 1;
    for (let press = 0; press < 5; press += 1) {
      scale = nextZoomStep(scale, "out");
      steps.push(scale);
    }

    expect(steps).toEqual([0.75, 0.5, 0.25, 0.25, 0.25]);
  });

  it("sube hasta el máximo por escalones redondos", () => {
    const steps: number[] = [];
    let scale = 1;
    for (let press = 0; press < 6; press += 1) {
      scale = nextZoomStep(scale, "in");
      steps.push(scale);
    }

    expect(steps).toEqual([1.25, 1.5, 2, 3, 4, 4]);
  });
});

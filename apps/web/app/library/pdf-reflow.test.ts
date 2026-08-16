import { describe, expect, it } from "vitest";

import {
  bodyFontSize,
  detectColumnSplit,
  groupIntoBlocks,
  groupIntoLines,
  joinLineText,
  reflowPage,
  toReflowItems,
  type ReflowTextItem,
} from "./pdf-reflow";

const pageWidth = 612;

/** Un fragmento de texto colocado sobre la página, como los que entrega pdf.js. */
function item(
  text: string,
  x: number,
  y: number,
  fontHeight = 10,
  fontName = "Times",
): ReflowTextItem {
  return { fontHeight, fontName, text, width: text.length * fontHeight * 0.5, x, y };
}

/** Renglón completo a partir de su texto, para las pruebas de bloques. */
function line(text: string, y: number, fontHeight = 10, x = 72) {
  return groupIntoLines([item(text, x, y, fontHeight)])[0]!;
}

describe("renglones", () => {
  it("reúne los fragmentos que comparten línea base y los ordena de izquierda a derecha", () => {
    const lines = groupIntoLines([
      item("mundo", 120, 700),
      item("Hola", 72, 700),
      item("Segundo renglón", 72, 680),
    ]);

    expect(lines.map((entry) => entry.text)).toEqual(["Hola mundo", "Segundo renglón"]);
  });

  it("lee la página de arriba abajo aunque los fragmentos vengan desordenados", () => {
    // El orden interno de un PDF no es el orden de lectura: es un problema conocido de
    // pdf.js y la razón por la que aquí se reordena por geometría.
    const lines = groupIntoLines([
      item("Tercero", 72, 660),
      item("Primero", 72, 700),
      item("Segundo", 72, 680),
    ]);

    expect(lines.map((entry) => entry.text)).toEqual(["Primero", "Segundo", "Tercero"]);
  });

  it("no separa una palabra que pdf.js partió en fragmentos contiguos", () => {
    // Sin umbral de hueco, un cambio de ajuste entre caracteres escribía «ca pí tu lo».
    const lines = groupIntoLines([
      item("ca", 72, 700),
      item("pí", 77, 700),
      item("tulo", 82, 700),
    ]);

    expect(lines[0]?.text).toBe("capítulo");
  });

  it("descarta los fragmentos vacíos sin dejar renglones fantasma", () => {
    expect(groupIntoLines([item("   ", 72, 700), item("", 90, 700)])).toEqual([]);
  });

  it("recompone las palabras de una portada compuesta con las letras separadas", () => {
    // Fragmentos exactos de la portada de «Una pequeña historia de la filosofía» del
    // corpus: el archivo guarda la separación tipográfica como espacios de verdad, y sin
    // recomponerla el título del libro llega deletreado.
    const lines = groupIntoLines([
      { fontHeight: 20.3, fontName: "g_d0_f2", text: "U N A", width: 59.8, x: 69.2, y: 407.8 },
      { fontHeight: 20.3, fontName: "g_d0_f2", text: " ", width: 18.9, x: 128.9, y: 407.8 },
      {
        fontHeight: 20.3,
        fontName: "g_d0_f2",
        text: "P E Q U E Ñ A",
        width: 143.7,
        x: 147.8,
        y: 407.8,
      },
    ]);

    expect(lines[0]?.text).toBe("UNA PEQUEÑA");
  });

  it("no junta las palabras de un encabezado corriente", () => {
    // Fragmentos exactos del encabezado de la página 8 del mismo libro: palabras enteras
    // separadas por fragmentos de espacio. La mitad de los fragmentos son ese espacio, así
    // que la comprobación de «texto deletreado» no puede contarlos como fragmentos cortos.
    const header = [
      { str: "El", x: 122, w: 7.6 },
      { str: " ", x: 129.5, w: 0.3 },
      { str: "hombre", x: 131.7, w: 26.7 },
      { str: " ", x: 158.4, w: 0.3 },
      { str: "que", x: 160.6, w: 12.4 },
      { str: " ", x: 173.1, w: 0.3 },
      { str: "hacía", x: 175.3, w: 18.2 },
      { str: " ", x: 193.5, w: 0.3 },
      { str: "preguntas", x: 195.7, w: 38.1 },
    ].map(({ str, x, w }) => ({
      fontHeight: 9,
      fontName: "Body",
      text: str,
      width: w,
      x,
      y: 541.6,
    }));

    expect(groupIntoLines(header)[0]?.text).toBe("El hombre que hacía preguntas");
  });

  it("no toca un renglón corriente al recomponer", () => {
    const lines = groupIntoLines([
      item("En la página 242 de la Historia de la guerra europea", 72, 700),
    ]);

    expect(lines[0]?.text).toBe("En la página 242 de la Historia de la guerra europea");
  });

  it("respeta las palabras de un título con las letras separadas a propósito", () => {
    // El caso real de una portada: cada letra llega como un fragmento con espaciado de
    // diseño. Con un umbral fijo salía «U N A P E Q U E Ñ A H I S T O R I A».
    const letterWidth = 6;
    const tracking = 4;
    const wordSpace = 12;
    const title = "UNA PEQUEÑA HISTORIA";
    const items: ReflowTextItem[] = [];
    let x = 72;

    for (const character of title) {
      if (character === " ") {
        x += wordSpace;
        continue;
      }
      items.push({
        fontHeight: 20,
        fontName: "Display",
        text: character,
        width: letterWidth,
        x,
        y: 700,
      });
      x += letterWidth + tracking;
    }

    expect(groupIntoLines(items)[0]?.text).toBe(title);
  });
});

describe("tamaño del texto corrido", () => {
  it("pesa por caracteres, no por fragmentos", () => {
    // Veinte números de página sueltos no pueden definir qué es «normal» en el documento.
    const items = [
      ...Array.from({ length: 20 }, (_, index) => item("7", 300, 40 - index, 8)),
      item("Un párrafo largo de texto corrido que ocupa la página", 72, 700, 11),
    ];

    expect(bodyFontSize(items)).toBe(11);
  });

  it("no se deja arrastrar por un título grande", () => {
    const items = [
      item("TÍTULO", 72, 720, 24),
      item("Cuerpo del documento con bastante texto", 72, 700, 10),
      item("y su continuación en el renglón siguiente", 72, 686, 10),
    ];

    expect(bodyFontSize(items)).toBe(10);
  });

  it("devuelve cero cuando no hay nada que medir", () => {
    expect(bodyFontSize([])).toBe(0);
  });
});

describe("bloques y unión de renglones", () => {
  it("junta renglones seguidos y separa cuando hay un salto vertical", () => {
    const lines = [
      line("Primera línea del párrafo", 700),
      line("segunda línea del párrafo", 688),
      // Un salto grande: empieza otro bloque.
      line("Un párrafo aparte", 620),
    ];

    const blocks = groupIntoBlocks(lines);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toHaveLength(2);
  });

  it("separa cuando cambia el tamaño aunque los renglones estén pegados", () => {
    const blocks = groupIntoBlocks([line("TÍTULO", 700, 20), line("Cuerpo", 686, 10)]);

    expect(blocks).toHaveLength(2);
  });

  it("une la palabra que el maquetador partió con guion", () => {
    // Es lo que más se nota al leer: sin esto quedaría «des- ayuno».
    expect(joinLineText([line("El des-", 700), line("ayuno de ayer", 688)])).toBe(
      "El desayuno de ayer",
    );
  });

  it("conserva el guion cuando pertenece al texto", () => {
    expect(joinLineText([line("teórico-", 700), line("Práctico", 688)])).toBe(
      "teórico- Práctico",
    );
  });
});

describe("páginas a dos columnas", () => {
  /**
   * Ocho renglones repartidos a ambos lados del canal. Los de una fila comparten línea
   * base, que es lo que ocurre en una página real y lo que obliga a decidir las columnas
   * antes de agrupar.
   */
  function twoColumnItems() {
    return Array.from({ length: 5 }, (_, index) => [
      item(`izquierda ${index}`, 72, 700 - index * 14),
      item(`derecha ${index}`, 330, 700 - index * 14),
    ]).flat();
  }

  it("reconoce el canal entre las dos columnas", () => {
    const split = detectColumnSplit(twoColumnItems(), pageWidth);

    expect(split).not.toBeNull();
    // Cae entre el final de la columna izquierda y el principio de la derecha.
    expect(split!).toBeGreaterThan(72 + 9 * 5);
    expect(split!).toBeLessThan(330);
  });

  it("no ve columnas donde solo hay texto corrido", () => {
    const items = Array.from({ length: 10 }, (_, index) =>
      item("Un renglón que cruza la página entera de lado a lado", 72, 700 - index * 14),
    );

    expect(detectColumnSplit(items, pageWidth)).toBeNull();
  });

  it("necesita material suficiente antes de decidir", () => {
    expect(detectColumnSplit([item("Solo un fragmento", 72, 700)], pageWidth)).toBeNull();
  });

  it("lee una columna entera antes de pasar a la otra", () => {
    const { blocks, columns } = reflowPage(twoColumnItems(), pageWidth);
    const text = blocks.map((block) => ("text" in block ? block.text : "")).join(" ");

    expect(columns).toBe(2);
    // Sin decidir las columnas primero saldría «izquierda 0 derecha 0 izquierda 1…».
    expect(text.indexOf("izquierda 4")).toBeLessThan(text.indexOf("derecha 0"));
  });

  it("coloca al principio lo que cruza el canal, como un titular", () => {
    const headline = item("Titular a todo lo ancho de la página", 72, 740, 18);
    const { blocks } = reflowPage([headline, ...twoColumnItems()], pageWidth);

    expect(blocks[0]).toMatchObject({ text: "Titular a todo lo ancho de la página" });
  });
});

describe("recomposición de una página", () => {
  it("distingue el título del cuerpo y ordena los niveles por tamaño", () => {
    const { blocks } = reflowPage(
      [
        item("Capítulo primero", 72, 720, 22),
        item("Una sección", 72, 690, 14),
        item("El texto corrido de la página, que es lo más frecuente", 72, 660, 10),
        item("y sigue en el renglón de abajo sin interrupción", 72, 648, 10),
      ],
      pageWidth,
    );

    expect(blocks).toEqual([
      { kind: "heading", level: 1, text: "Capítulo primero" },
      { kind: "heading", level: 2, text: "Una sección" },
      {
        kind: "paragraph",
        text: "El texto corrido de la página, que es lo más frecuente y sigue en el renglón de abajo sin interrupción",
      },
    ]);
  });

  it("reconoce como subtítulo la negrita del mismo tamaño que el cuerpo", () => {
    const { blocks } = reflowPage(
      [
        item("Advertencia", 72, 700, 10, "Helvetica-Bold"),
        item("El texto corriente de la página continúa aquí abajo", 72, 670, 10),
        item("con su segundo renglón para fijar el cuerpo", 72, 658, 10),
      ],
      pageWidth,
    );

    expect(blocks[0]).toEqual({ kind: "heading", level: 1, text: "Advertencia" });
    expect(blocks[1]?.kind).toBe("paragraph");
  });

  it("devuelve vacío en una página sin capa de texto", () => {
    // Los escaneados del corpus: no hay nada que recomponer hasta que llegue el OCR.
    expect(reflowPage([], pageWidth)).toEqual({ blocks: [], columns: 1 });
  });
});

describe("conversión desde pdf.js", () => {
  it("saca la posición y el cuerpo real de la matriz de transformación", () => {
    const [converted] = toReflowItems([
      { fontName: "Times", str: "Hola", transform: [12, 0, 0, 12, 72, 700], width: 24 },
    ]);

    expect(converted).toEqual({
      fontHeight: 12,
      fontName: "Times",
      text: "Hola",
      width: 24,
      x: 72,
      y: 700,
    });
  });

  it("descarta lo que no trae posición en vez de colocarlo en el origen", () => {
    expect(toReflowItems([{ str: "Suelto" }, { transform: [1, 0, 0, 1, 0, 0] }])).toEqual([]);
  });
});

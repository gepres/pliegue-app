import { describe, expect, it } from "vitest";

import { hashText } from "./translation";
import { browserEngine, translateBlocks, type OpenTranslator } from "./translation-engine";

/** Un traductor de mentira: marca lo que recibe y cuenta cuántas veces se le llamó. */
function fakeTranslator() {
  const calls: string[] = [];
  const translator: OpenTranslator = {
    destroy: () => undefined,
    translate: async (text) => {
      calls.push(text);
      return `«${text}»`;
    },
  };
  return { calls, translator };
}

describe("traducir los bloques de una página", () => {
  it("traduce en orden y copia lo que no tiene palabras", async () => {
    const { calls, translator } = fakeTranslator();
    const blocks = await translateBlocks(translator, ["Chapter one", "12", "The end."]);

    expect(blocks.map((block) => block.text)).toEqual(["«Chapter one»", "12", "«The end.»"]);
    expect(blocks[1]?.hash).toBe(hashText("12"));
    expect(calls).toEqual(["Chapter one", "The end."]);
  });

  it("parte un párrafo muy largo por frases y lo vuelve a unir", async () => {
    const { calls, translator } = fakeTranslator();
    const sentence = `${"This sentence has a handful of ordinary words ".repeat(4).trim()}.`;
    const long = Array.from({ length: 12 }, () => sentence).join(" ");
    const [block] = await translateBlocks(translator, [long]);

    expect(calls.length).toBeGreaterThan(1);
    expect(calls.every((chunk) => chunk.length <= 1200)).toBe(true);
    expect(block?.hash).toBe(hashText(long));
  });

  it("traduce renglón a renglón lo que llega con saltos, como un índice", async () => {
    const { calls, translator } = fakeTranslator();
    const [block] = await translateBlocks(translator, ["Plates of the valley 12\nA map of the coast 14\n16"]);

    expect(block?.text).toBe("«Plates of the valley 12»\n«A map of the coast 14»\n16");
    expect(calls).toEqual(["Plates of the valley 12", "A map of the coast 14"]);
  });

  it("se detiene si se cancela", async () => {
    const { translator } = fakeTranslator();
    const controller = new AbortController();
    controller.abort();
    await expect(translateBlocks(translator, ["Some text"], controller.signal)).rejects.toThrow();
  });

  it("dice que no está disponible donde el navegador no trae traductor", async () => {
    expect(await browserEngine.availability({ source: "en", target: "es" })).toBe("unsupported");
  });
});

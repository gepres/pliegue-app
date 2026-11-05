import { describe, expect, it } from "vitest";

import { hashText, type TranslatedBlock } from "./translation";
import { translateBlocks, type OpenTranslator } from "./translation-engine";
import {
  applyGlossary,
  cleanEntry,
  cleanGlossary,
  entriesForTexts,
  glossaryHash,
  glossaryInstructions,
  matchingEntries,
} from "./translation-glossary";
import { TranslationSession } from "./translation-session";

const naacal = { source: "Naacal", target: "naacal" };
const writings = { source: "Sacred Inspired Writings", target: "Escrituras Sagradas Inspiradas" };
const sea = { source: "Sea", target: "Mar" };
const deadSea = { source: "Dead Sea", target: "Mar Muerto" };

describe("el glosario de un libro (05.5)", () => {
  it("limpia los términos: sin espacios de sobra, sin vacíos ni larguísimos, y sin repetir", () => {
    expect(cleanEntry({ source: "  Naacal ", target: " naacal\n" })).toEqual({ source: "Naacal", target: "naacal" });
    expect(cleanEntry({ source: "Mu", target: "" })).toBeNull();
    expect(cleanEntry({ source: "x".repeat(121), target: "y" })).toBeNull();
    expect(cleanGlossary([naacal, { source: "naacal", target: "los naacal" }, { nope: true }, "texto"])).toEqual([
      { source: "naacal", target: "los naacal" },
    ]);
  });

  it("encuentra el término como palabra entera, sin distinguir mayúsculas y con cualquier espacio", () => {
    const text = "The NAACAL brothers kept the Sacred  Inspired\nWritings; a Naacalism is something else.";
    expect(matchingEntries(text, [naacal, writings, sea])).toEqual([naacal, writings]);
    expect(entriesForTexts(["Across the Dead Sea.", "Nothing here."], [naacal, deadSea])).toEqual([deadSea]);
  });

  it("sustituye antes de traducir: lo largo primero, sin volver a tocar lo puesto y con su mayúscula", () => {
    expect(applyGlossary("The Dead Sea is not the Sea of Mu.", [sea, deadSea])).toBe("The Mar Muerto is not the Mar of Mu.");
    expect(applyGlossary("Naacal tablets were kept by the naacal.", [naacal])).toBe("Naacal tablets were kept by the naacal.");
    // Una traducción que contiene otro término no se vuelve a sustituir.
    expect(applyGlossary("Sea and Mar.", [sea, { source: "Mar", target: "Marte" }])).toBe("Mar and Marte.");
  });

  it("la huella de un bloque cambia solo si cambia la traducción de un término que usa", () => {
    const text = "The Naacal wrote it.";
    expect(glossaryHash(text, [])).toBe(hashText(text));
    expect(glossaryHash(text, [sea])).toBe(hashText(text));
    const before = glossaryHash(text, [naacal]);
    expect(before).not.toBe(hashText(text));
    expect(glossaryHash(text, [naacal, sea])).toBe(before);
    expect(glossaryHash(text, [{ source: "Naacal", target: "los naacales" }])).not.toBe(before);
  });

  it("a una IA se le dice en las instrucciones, término a término", () => {
    expect(glossaryInstructions([])).toBe("");
    expect(glossaryInstructions([naacal, writings])).toBe(
      [
        "Usa siempre estas traducciones para estos términos, también en plural o en mayúscula:",
        "- «Naacal» → «naacal»",
        "- «Sacred Inspired Writings» → «Escrituras Sagradas Inspiradas»",
      ].join("\n"),
    );
  });
});

describe("el glosario al traducir", () => {
  it("al traductor del navegador le llega el término ya sustituido", async () => {
    const seen: string[] = [];
    const translator: OpenTranslator = {
      destroy: () => {},
      translate: async (text) => {
        seen.push(text);
        return `ES(${text})`;
      },
    };
    const [block] = await translateBlocks(translator, ["The Naacal wrote it."], undefined, [naacal, sea]);
    expect(seen).toEqual(["The naacal wrote it."]);
    expect(block).toEqual({ hash: glossaryHash("The Naacal wrote it.", [naacal]), text: "ES(The naacal wrote it.)" });
  });

  it("a una IA le llega el original y, aparte, solo los términos que aparecen", async () => {
    const calls: { glossary: unknown; texts: readonly string[] }[] = [];
    const translator: OpenTranslator = {
      destroy: () => {},
      glossary: "instructions",
      translate: async (text) => text,
      translateMany: async (texts, _signal, glossary) => {
        calls.push({ glossary, texts });
        return texts.map((text) => `ES(${text})`);
      },
    };
    await translateBlocks(translator, ["The Naacal wrote it.", "12"], undefined, [naacal, writings]);
    expect(calls).toEqual([{ glossary: [naacal], texts: ["The Naacal wrote it."] }]);
  });

  it("a DeepL, Azure o LibreTranslate (por lotes, sin instrucciones) también se lo sustituye", async () => {
    const calls: { glossary: unknown; texts: readonly string[] }[] = [];
    const translator: OpenTranslator = {
      destroy: () => {},
      translate: async (text) => text,
      translateMany: async (texts, _signal, glossary) => {
        calls.push({ glossary, texts });
        return [...texts];
      },
    };
    await translateBlocks(translator, ["Across the Dead Sea."], undefined, [deadSea]);
    expect(calls).toEqual([{ glossary: undefined, texts: ["Across the Mar Muerto."] }]);
  });

  it("al corregir un término, la sesión vuelve a traducir solo los bloques donde aparece", async () => {
    const page = { blocks: [{ text: "The Naacal wrote it." }, { text: "Nothing to see." }, { text: "Again the Naacal." }] };
    const stored = new Map<string, TranslatedBlock[]>();
    const translated: string[] = [];
    let glossary = [naacal];
    const session = new TranslationSession({
      glossary: () => glossary,
      loadUnit: async () => page,
      pagesAhead: 0,
      storage: {
        read: async (id) => stored.get(id) ?? null,
        write: async (id, blocks) => {
          stored.set(id, blocks);
        },
      },
      storedIds: new Set(),
      translator: {
        destroy: () => {},
        translate: async (text) => {
          translated.push(text);
          return `ES(${text})`;
        },
      },
      unitCount: 1,
      unitId: () => "page:1",
    });
    const settle = () =>
      new Promise<void>((resolve) => {
        const check = () => {
          const snapshot = session.getSnapshot();
          if (snapshot.working === null && snapshot.pending.length === 0) resolve();
        };
        session.subscribe(check);
        setTimeout(check, 0);
      });

    session.setCurrent(1);
    await settle();
    expect(translated).toEqual(["The naacal wrote it.", "Nothing to see.", "Again the naacal."]);

    translated.length = 0;
    glossary = [{ source: "Naacal", target: "los naacales" }];
    session.refreshGlossary();
    await settle();
    // El bloque sin el término no se vuelve a pedir: no cuesta nada ni cambia.
    expect(translated).toEqual(["The los naacales wrote it.", "Again the los naacales."]);
    expect(session.unit(1)?.translated.map((block) => block.text)).toEqual([
      "ES(The los naacales wrote it.)",
      "ES(Nothing to see.)",
      "ES(Again the los naacales.)",
    ]);
    expect(stored.get("page:1")?.[1]?.hash).toBe(hashText("Nothing to see."));
    session.dispose();
  });
});

import { describe, expect, it } from "vitest";

import {
  addUsage,
  budgetMessage,
  checkBudget,
  defaultAiBudget,
  monthKey,
  parseAiBudget,
  spendOf,
  sumUsage,
  type AiBudget,
  type MonthUsage,
} from "./ai-budget";

const budget = (partial: Partial<AiBudget> = {}): AiBudget => ({ ...defaultAiBudget, ...partial });

describe("contar lo gastado", () => {
  it("suma por proveedor y modelo, y cuenta las peticiones", () => {
    let month: MonthUsage = {};
    month = addUsage(month, "openai", "gpt-6-luna", { inputTokens: 1000, outputTokens: 200 });
    month = addUsage(month, "openai", "gpt-6-luna", { inputTokens: 500, outputTokens: 100 });
    month = addUsage(month, "deepl", "-", { characters: 3000 });
    expect(month.openai?.["gpt-6-luna"]).toEqual({ characters: 0, inputTokens: 1500, outputTokens: 300, requests: 2 });
    expect(month.deepl?.["-"]).toMatchObject({ characters: 3000, requests: 1 });
  });

  it("el total del mes es la suma de los equipos", () => {
    const pc = addUsage({}, "openai", "gpt-6-luna", { inputTokens: 1000, outputTokens: 0 });
    const laptop = addUsage({}, "openai", "gpt-6-luna", { inputTokens: 250, outputTokens: 50 });
    expect(sumUsage([pc, laptop]).openai?.["gpt-6-luna"]).toEqual({ characters: 0, inputTokens: 1250, outputTokens: 50, requests: 2 });
  });

  it("el mes es el de este equipo, con dos cifras", () => {
    expect(monthKey(new Date(2026, 10, 6))).toBe("2026-11");
    expect(monthKey(new Date(2027, 0, 31))).toBe("2027-01");
  });
});

describe("el importe estimado", () => {
  it("usa la tabla de precios por millón de tokens y por millón de caracteres", () => {
    let month: MonthUsage = addUsage({}, "openai", "gpt-6-luna", { inputTokens: 1_000_000, outputTokens: 1_000_000 });
    month = addUsage(month, "deepl", "-", { characters: 2_000_000 });
    const spend = spendOf(month, budget());
    expect(spend.byProvider.openai?.usd).toBeCloseTo(0.6);
    expect(spend.byProvider.deepl?.usd).toBeCloseTo(50);
    expect(spend.usd).toBeCloseTo(50.6);
    expect(spend.tokens).toBe(2_000_000);
  });

  it("un modelo sin precio cuenta tokens, no dólares, y se dice cuál", () => {
    const spend = spendOf(addUsage({}, "openai", "gpt-9-nube", { inputTokens: 4000, outputTokens: 1000 }), budget());
    expect(spend.byProvider.openai).toMatchObject({ missingPrices: ["gpt-9-nube"], tokens: 5000, usd: 0 });
  });

  it("Ollama y LibreTranslate se cuentan pero no entran en el total que cobra", () => {
    let month = addUsage({}, "ollama", "qwen3:8b", { inputTokens: 9000, outputTokens: 3000 });
    month = addUsage(month, "libretranslate", "-", { characters: 5000 });
    const spend = spendOf(month, budget());
    expect(spend.byProvider.ollama?.tokens).toBe(12000);
    expect(spend.tokens).toBe(0);
    expect(spend.usd).toBe(0);
  });
});

describe("cómo va el presupuesto", () => {
  const usd = (amount: number): MonthUsage =>
    // 1 M de tokens de salida de gpt-6-luna son 0,5 $: se ajusta la salida para el importe pedido.
    addUsage({}, "openai", "gpt-6-luna", { inputTokens: 0, outputTokens: Math.round(amount * 2_000_000) });

  it("sin límites, siempre bien", () => {
    expect(checkBudget(spendOf(usd(1000), budget()), budget(), "openai").level).toBe("ok");
  });

  it("avisa al 80 % y para al 100 % del global en dólares", () => {
    const limits = budget({ monthlyUsd: 10 });
    expect(checkBudget(spendOf(usd(7), limits), limits, "openai").level).toBe("ok");
    expect(checkBudget(spendOf(usd(8), limits), limits, "openai").level).toBe("warn");
    expect(checkBudget(spendOf(usd(10), limits), limits, "openai")).toMatchObject({ label: "el presupuesto del mes en dólares", level: "over" });
  });

  it("el de un proveedor solo frena a ese proveedor", () => {
    const limits = budget({ providers: { openai: { units: null, usd: 1 } } });
    const spend = spendOf(usd(2), limits);
    expect(checkBudget(spend, limits, "openai")).toMatchObject({ label: "el presupuesto de OpenAI en dólares", level: "over" });
    expect(checkBudget(spend, limits, "gemini").level).toBe("ok");
  });

  it("DeepL y Azure se limitan en caracteres", () => {
    const limits = budget({ providers: { deepl: { units: 10_000, usd: null } } });
    const spend = spendOf(addUsage({}, "deepl", "-", { characters: 9_000 }), limits);
    expect(checkBudget(spend, limits, "deepl")).toMatchObject({ label: "el presupuesto de DeepL en caracteres", level: "warn" });
  });

  it("lo que no cobra nunca se frena", () => {
    const limits = budget({ monthlyUsd: 0.01 });
    expect(checkBudget(spendOf(usd(5), limits), limits, "ollama").level).toBe("ok");
  });

  it("lo dice con el mes", () => {
    const check = { label: "el presupuesto de OpenAI en dólares", level: "warn" as const, ratio: 0.83 };
    expect(budgetMessage(check, "2026-11")).toBe("En noviembre llevas el 83 % del presupuesto de OpenAI en dólares.");
    expect(budgetMessage({ ...check, level: "over", ratio: 1.1 }, "2026-11")).toBe("En noviembre se alcanzó el presupuesto de OpenAI en dólares.");
  });
});

describe("leer el presupuesto guardado", () => {
  it("lo roto o negativo se descarta; vacío es sin límite", () => {
    const parsed = parseAiBudget({
      characterPrices: { deepl: -3 },
      monthlyTokens: "mucho",
      monthlyUsd: 25,
      providers: { gemini: { units: 0, usd: 5 }, inventado: { usd: 1 } },
      tokenPrices: { "openai:gpt-6-luna": { input: 0.1, output: 0.5 }, roto: { input: 1, output: 1 }, "gemini:x": { input: -1, output: 2 } },
    });
    expect(parsed.monthlyUsd).toBe(25);
    expect(parsed.monthlyTokens).toBeNull();
    expect(parsed.providers).toEqual({ gemini: { units: null, usd: 5 } });
    expect(parsed.tokenPrices).toEqual({ "openai:gpt-6-luna": { input: 0.1, output: 0.5 } });
    expect(parsed.characterPrices.deepl).toBe(25);
  });

  it("sin nada guardado, los precios de partida y sin límites", () => {
    expect(parseAiBudget(undefined)).toEqual(defaultAiBudget);
  });
});

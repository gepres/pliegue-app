/**
 * Presupuesto de IA (04.6, decisión del 6-nov): se cuentan siempre los tokens (o los caracteres,
 * en DeepL y Azure) de cada proveedor, y además un importe estimado en dólares con una tabla de
 * precios editable. Hay un límite global y otro por proveedor; se avisa al 80 % y al 100 % se
 * para antes de la siguiente sección o documento.
 *
 * Aquí solo hay datos y cuentas, sin navegador: el contador vive en `ai-usage-store.ts`.
 */

/** Los que cobran: a ellos se aplican los límites. Ollama, LibreTranslate y el navegador, no. */
export const budgetProviders = ["openai", "anthropic", "gemini", "azure", "deepl"] as const;
export type BudgetProvider = (typeof budgetProviders)[number];

/** DeepL y Azure Translator cobran por caracteres, no por tokens. */
export const characterProviders: readonly BudgetProvider[] = ["azure", "deepl"];

export const budgetProviderNames: Record<string, string> = {
  anthropic: "Claude",
  azure: "Azure Translator",
  deepl: "DeepL",
  gemini: "Gemini",
  libretranslate: "LibreTranslate",
  ollama: "Ollama",
  openai: "OpenAI",
};

export function isBudgetProvider(provider: string): provider is BudgetProvider {
  return (budgetProviders as readonly string[]).includes(provider);
}

/* ---- El contador ----------------------------------------------------------------------------- */

export interface UsageCounter {
  characters: number;
  inputTokens: number;
  outputTokens: number;
  requests: number;
}

/** Lo gastado en un mes, por proveedor y modelo («deepl» y «azure» usan el modelo «-»). */
export type MonthUsage = Record<string, Record<string, UsageCounter>>;

export const emptyCounter = (): UsageCounter => ({ characters: 0, inputTokens: 0, outputTokens: 0, requests: 0 });

/** «2026-11», en la hora de este equipo: el mes que ve la persona. */
export function monthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

const finite = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0);

export function addUsage(
  month: MonthUsage,
  provider: string,
  model: string,
  usage: { characters?: number; inputTokens?: number; outputTokens?: number },
): MonthUsage {
  const byModel = { ...(month[provider] ?? {}) };
  const current = byModel[model] ?? emptyCounter();
  byModel[model] = {
    characters: current.characters + finite(usage.characters),
    inputTokens: current.inputTokens + finite(usage.inputTokens),
    outputTokens: current.outputTokens + finite(usage.outputTokens),
    requests: current.requests + 1,
  };
  return { ...month, [provider]: byModel };
}

/** La suma de varios equipos: cada uno sube su contador del mes y el total es la suma. */
export function sumUsage(months: readonly MonthUsage[]): MonthUsage {
  const total: MonthUsage = {};
  for (const month of months) {
    for (const [provider, byModel] of Object.entries(month)) {
      for (const [model, counter] of Object.entries(byModel)) {
        const current = total[provider]?.[model] ?? emptyCounter();
        total[provider] = {
          ...(total[provider] ?? {}),
          [model]: {
            characters: current.characters + finite(counter.characters),
            inputTokens: current.inputTokens + finite(counter.inputTokens),
            outputTokens: current.outputTokens + finite(counter.outputTokens),
            requests: current.requests + finite(counter.requests),
          },
        };
      }
    }
  }
  return total;
}

export function parseMonthUsage(value: unknown): MonthUsage {
  const usage: MonthUsage = {};
  if (!isRecord(value)) return usage;
  for (const [provider, byModel] of Object.entries(value)) {
    if (!isRecord(byModel)) continue;
    for (const [model, counter] of Object.entries(byModel)) {
      if (!isRecord(counter)) continue;
      usage[provider] = {
        ...(usage[provider] ?? {}),
        [model.slice(0, 120)]: {
          characters: finite(counter.characters),
          inputTokens: finite(counter.inputTokens),
          outputTokens: finite(counter.outputTokens),
          requests: finite(counter.requests),
        },
      };
    }
  }
  return usage;
}

/* ---- Límites y precios (van con los ajustes de IA, que se sincronizan) ------------------------- */

export interface ProviderLimit {
  /** Unidades: tokens, o caracteres en DeepL y Azure. */
  units: number | null;
  usd: number | null;
}

export interface AiBudget {
  /** $ por millón de caracteres. */
  characterPrices: Record<string, number>;
  monthlyTokens: number | null;
  monthlyUsd: number | null;
  providers: Partial<Record<BudgetProvider, ProviderLimit>>;
  /** $ por millón de tokens, por «proveedor:modelo». Un modelo sin precio no suma dólares. */
  tokenPrices: Record<string, { input: number; output: number }>;
}

/**
 * Precios de partida, verificados el 6-nov-2026 en Artificial Analysis (artificialanalysis.ai):
 * los modelos de partida de ahora y los anteriores, que siguen en uso hasta que se migran. Un
 * modelo que no está aquí queda sin precio, y Ajustes lo dice para que la persona lo ponga.
 */
export const defaultAiBudget: AiBudget = {
  characterPrices: { azure: 10, deepl: 25 },
  monthlyTokens: null,
  monthlyUsd: null,
  providers: {},
  tokenPrices: {
    "anthropic:claude-haiku-4-5": { input: 1, output: 5 },
    "anthropic:claude-haiku-5-5": { input: 0.1, output: 0.5 },
    "anthropic:claude-sonnet-5-5": { input: 2, output: 10 },
    "gemini:gemini-3.5-flash-lite": { input: 0.3, output: 2.5 },
    // Recomendar (06.1), 8-nov-2026 en las páginas de precios de Google y OpenAI. Gemini 3.8 Flash
    // con el precio de 2027 (hasta el 31-dic cuesta la mitad): el presupuesto se pasa de largo, no
    // se queda corto.
    "gemini:gemini-3.8-flash": { input: 1.5, output: 7.5 },
    "openai:gpt-6.1-sol": { input: 2, output: 10 },
    "openai:gpt-5.6-luna": { input: 0.2, output: 1.2 },
    "openai:gpt-6-luna": { input: 0.1, output: 0.5 },
  },
};

export const priceKey = (provider: string, model: string) => `${provider}:${model}`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Un límite: un número positivo, o nada (sin límite). */
function limit(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/** Un precio: cero vale (gratis); negativo o roto, no. */
function price(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function parseAiBudget(value: unknown): AiBudget {
  if (!isRecord(value)) return defaultAiBudget;
  const providers: AiBudget["providers"] = {};
  const rawProviders = isRecord(value.providers) ? value.providers : {};
  for (const provider of budgetProviders) {
    const entry = rawProviders[provider];
    if (!isRecord(entry)) continue;
    const parsed = { units: limit(entry.units), usd: limit(entry.usd) };
    if (parsed.units !== null || parsed.usd !== null) providers[provider] = parsed;
  }
  const tokenPrices: AiBudget["tokenPrices"] = {};
  const rawPrices = isRecord(value.tokenPrices) ? value.tokenPrices : defaultAiBudget.tokenPrices;
  for (const [key, entry] of Object.entries(rawPrices).slice(0, 60)) {
    if (!isRecord(entry) || !/^[a-z]+:.{1,120}$/.test(key)) continue;
    const input = price(entry.input);
    const output = price(entry.output);
    if (input !== null && output !== null) tokenPrices[key] = { input, output };
  }
  const rawCharacters = isRecord(value.characterPrices) ? value.characterPrices : {};
  const characterPrices: AiBudget["characterPrices"] = { ...defaultAiBudget.characterPrices };
  for (const provider of characterProviders) {
    const parsed = price(rawCharacters[provider]);
    if (parsed !== null) characterPrices[provider] = parsed;
  }
  return {
    characterPrices,
    monthlyTokens: limit(value.monthlyTokens),
    monthlyUsd: limit(value.monthlyUsd),
    providers,
    tokenPrices,
  };
}

/* ---- Cuánto va y cuánto queda ----------------------------------------------------------------- */

export interface ProviderSpend {
  characters: number;
  /** Modelos usados sin precio en la tabla: sus tokens cuentan, sus dólares no. */
  missingPrices: string[];
  tokens: number;
  usd: number;
}

export interface Spend {
  byProvider: Record<string, ProviderSpend>;
  /** Tokens de los proveedores que cobran (los locales no cuentan para el límite global). */
  tokens: number;
  usd: number;
}

export function spendOf(usage: MonthUsage, budget: AiBudget): Spend {
  const spend: Spend = { byProvider: {}, tokens: 0, usd: 0 };
  for (const [provider, byModel] of Object.entries(usage)) {
    const entry: ProviderSpend = { characters: 0, missingPrices: [], tokens: 0, usd: 0 };
    for (const [model, counter] of Object.entries(byModel)) {
      entry.tokens += counter.inputTokens + counter.outputTokens;
      entry.characters += counter.characters;
      if (characterProviders.includes(provider as BudgetProvider)) {
        entry.usd += (counter.characters / 1_000_000) * (budget.characterPrices[provider] ?? 0);
        continue;
      }
      if (!isBudgetProvider(provider)) continue;
      const prices = budget.tokenPrices[priceKey(provider, model)];
      if (!prices) {
        if (counter.inputTokens + counter.outputTokens > 0) entry.missingPrices.push(model);
        continue;
      }
      entry.usd += (counter.inputTokens * prices.input + counter.outputTokens * prices.output) / 1_000_000;
    }
    spend.byProvider[provider] = entry;
    if (isBudgetProvider(provider)) {
      spend.usd += entry.usd;
      spend.tokens += entry.tokens;
    }
  }
  return spend;
}

export type BudgetLevel = "ok" | "warn" | "over";

export interface BudgetCheck {
  /** El que más cerca está de su tope, para decirlo. */
  label: string | null;
  level: BudgetLevel;
  ratio: number;
}

export const warnRatio = 0.8;

/**
 * Cómo va el presupuesto para un proveedor: el peor de sus límites (el global en dólares y en
 * tokens, y el suyo). Sin proveedor, solo los globales. Los proveedores que no cobran, siempre
 * bien.
 */
export function checkBudget(spend: Spend, budget: AiBudget, provider?: string): BudgetCheck {
  if (provider !== undefined && !isBudgetProvider(provider)) return { label: null, level: "ok", ratio: 0 };
  const checks: Array<{ label: string; ratio: number }> = [];
  if (budget.monthlyUsd) checks.push({ label: "el presupuesto del mes en dólares", ratio: spend.usd / budget.monthlyUsd });
  if (budget.monthlyTokens) checks.push({ label: "el presupuesto del mes en tokens", ratio: spend.tokens / budget.monthlyTokens });
  if (provider) {
    const own = budget.providers[provider];
    const used = spend.byProvider[provider];
    const name = budgetProviderNames[provider] ?? provider;
    if (own?.usd) checks.push({ label: `el presupuesto de ${name} en dólares`, ratio: (used?.usd ?? 0) / own.usd });
    if (own?.units) {
      const units = characterProviders.includes(provider) ? (used?.characters ?? 0) : (used?.tokens ?? 0);
      const unit = characterProviders.includes(provider) ? "caracteres" : "tokens";
      checks.push({ label: `el presupuesto de ${name} en ${unit}`, ratio: units / own.units });
    }
  }
  const worst = checks.reduce<{ label: string; ratio: number } | null>((max, check) => (!max || check.ratio > max.ratio ? check : max), null);
  if (!worst) return { label: null, level: "ok", ratio: 0 };
  return { label: worst.label, level: worst.ratio >= 1 ? "over" : worst.ratio >= warnRatio ? "warn" : "ok", ratio: worst.ratio };
}

const monthNames = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export function monthName(key: string) {
  const month = Number(key.slice(5, 7));
  return monthNames[month - 1] ?? key;
}

/** «En noviembre se alcanzó el presupuesto de OpenAI en dólares.» */
export function budgetMessage(check: BudgetCheck, month: string) {
  const what = check.label ?? "el presupuesto de IA";
  const when = monthName(month);
  if (check.level === "over") return `En ${when} se alcanzó ${what}.`;
  // «el 83 % del presupuesto», no «de el».
  const of = what.startsWith("el ") ? `del ${what.slice(3)}` : `de ${what}`;
  return `En ${when} llevas el ${Math.floor(check.ratio * 100)} % ${of}.`;
}

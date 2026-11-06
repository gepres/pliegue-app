"use client";

import { useState, type FormEvent } from "react";

import { Button, Card, Field, Input } from "@pliegue/ui";

import {
  budgetMessage,
  budgetProviderNames,
  budgetProviders,
  characterProviders,
  checkBudget,
  isBudgetProvider,
  monthKey,
  monthName,
  parseAiBudget,
  priceKey,
  spendOf,
  type AiBudget,
  type BudgetProvider,
  type MonthUsage,
} from "../../ai/ai-budget";
import type { AiSettings } from "../../ai/ai-settings";
import { saveAiSettings, useAiSettings } from "../../ai/ai-settings-store";
import { monthUsageOf, useAiUsageStore, useMonthKey } from "../../ai/ai-usage-store";
import styles from "./ai-budget-panel.module.css";

const dollars = new Intl.NumberFormat("es", { currency: "USD", maximumFractionDigits: 2, minimumFractionDigits: 2, style: "currency" });
const smallDollars = new Intl.NumberFormat("es", { currency: "USD", maximumFractionDigits: 4, minimumFractionDigits: 2, style: "currency" });
const number = (value: number) => Math.round(value).toLocaleString("es");

function money(value: number) {
  return value > 0 && value < 0.01 ? smallDollars.format(value) : dollars.format(value);
}

/** Texto de un número del formulario: vacío es «sin límite» o «sin precio». */
const asText = (value: number | null | undefined) => (value === null || value === undefined ? "" : String(value));

function asNumber(text: string) {
  const value = Number(text.replace(",", ".").trim());
  return text.trim() === "" || !Number.isFinite(value) ? null : value;
}

interface Draft {
  characterPrices: Record<string, string>;
  monthlyTokens: string;
  monthlyUsd: string;
  providers: Record<string, { units: string; usd: string }>;
  tokenPrices: Record<string, { input: string; output: string }>;
}

function toDraft(budget: AiBudget, models: readonly string[]): Draft {
  return {
    characterPrices: Object.fromEntries(characterProviders.map((provider) => [provider, asText(budget.characterPrices[provider])])),
    monthlyTokens: asText(budget.monthlyTokens),
    monthlyUsd: asText(budget.monthlyUsd),
    providers: Object.fromEntries(
      budgetProviders.map((provider) => [provider, { units: asText(budget.providers[provider]?.units), usd: asText(budget.providers[provider]?.usd) }]),
    ),
    tokenPrices: Object.fromEntries(
      models.map((key) => [key, { input: asText(budget.tokenPrices[key]?.input), output: asText(budget.tokenPrices[key]?.output) }]),
    ),
  };
}

function fromDraft(draft: Draft): AiBudget {
  const tokenPrices: Record<string, { input: number; output: number }> = {};
  for (const [key, prices] of Object.entries(draft.tokenPrices)) {
    const input = asNumber(prices.input);
    const output = asNumber(prices.output);
    if (input !== null && output !== null) tokenPrices[key] = { input, output };
  }
  return parseAiBudget({
    characterPrices: Object.fromEntries(Object.entries(draft.characterPrices).map(([provider, text]) => [provider, asNumber(text)])),
    monthlyTokens: asNumber(draft.monthlyTokens),
    monthlyUsd: asNumber(draft.monthlyUsd),
    providers: Object.fromEntries(
      Object.entries(draft.providers).map(([provider, limit]) => [provider, { units: asNumber(limit.units), usd: asNumber(limit.usd) }]),
    ),
    tokenPrices,
  });
}

/** Los modelos con precio: los elegidos para catalogar y traducir, los de la tabla y los usados. */
function pricedModels(settings: AiSettings, used: MonthUsage) {
  const keys = new Set<string>();
  for (const provider of ["openai", "anthropic", "gemini"] as const) {
    keys.add(priceKey(provider, settings.models[provider]));
    keys.add(priceKey(provider, settings.translationModels[provider]));
  }
  for (const key of Object.keys(settings.budget.tokenPrices)) keys.add(key);
  for (const [provider, byModel] of Object.entries(used)) {
    if (!isBudgetProvider(provider) || characterProviders.includes(provider)) continue;
    for (const model of Object.keys(byModel)) keys.add(priceKey(provider, model));
  }
  return [...keys].sort();
}

/**
 * Ajustes → IA: lo gastado este mes y el presupuesto (04.6). Los límites y los precios van con
 * los ajustes de IA, así que con la cuenta valen en todos los equipos.
 */
export function AiBudgetPanel() {
  const settings = useAiSettings();
  const stored = useAiUsageStore();
  // Sin mes (servidor e hidratación) no hay gasto que enseñar: así coinciden los dos HTML.
  const month = useMonthKey();
  const usage = monthUsageOf(stored, month ?? "");
  const spend = spendOf(usage.total, settings.budget);
  const overall = checkBudget(spend, settings.budget);

  const models = pricedModels(settings, usage.total);

  // Solo mientras se edita: si no, el formulario enseña lo guardado (también lo que llega de la
  // cuenta o de otra pestaña). Inicializarlo con el primer render lo dejaba con los ajustes de
  // fábrica de la hidratación, y guardar habría borrado el límite.
  const [editing, setEditing] = useState<Draft | null>(null);
  const draft = editing ?? toDraft(settings.budget, models);
  const setDraft = (change: (current: Draft) => Draft) => setEditing((current) => change(current ?? toDraft(settings.budget, models)));
  const [saved, setSaved] = useState<string | null>(null);
  // Un modelo nuevo en los ajustes entra en la tabla sin perder lo que se está escribiendo.
  const rows = models.map((key) => ({ key, prices: draft.tokenPrices[key] ?? { input: "", output: "" } }));

  const providersInUse = [
    ...budgetProviders.filter((provider) => usage.total[provider] || settings.budget.providers[provider]),
    ...Object.keys(usage.total).filter((provider) => !isBudgetProvider(provider)),
  ];
  const missing = Object.entries(spend.byProvider).flatMap(([provider, entry]) =>
    entry.missingPrices.map((model) => `${model} (${budgetProviderNames[provider] ?? provider})`),
  );

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const budget = fromDraft({ ...draft, tokenPrices: Object.fromEntries(rows.map((row) => [row.key, row.prices])) });
    saveAiSettings({ ...settings, budget });
    setEditing(null);
    setSaved("Presupuesto guardado.");
  }

  const setProvider = (provider: string, field: "units" | "usd", value: string) =>
    setDraft((current) => ({
      ...current,
      providers: { ...current.providers, [provider]: { ...(current.providers[provider] ?? { units: "", usd: "" }), [field]: value } },
    }));
  const setPrice = (key: string, field: "input" | "output", value: string) =>
    setDraft((current) => ({
      ...current,
      tokenPrices: { ...current.tokenPrices, [key]: { ...(current.tokenPrices[key] ?? { input: "", output: "" }), [field]: value } },
    }));

  return (
    <Card aria-labelledby="ai-budget-title" as="section" className={styles.panel}>
      <div className={styles.intro}>
        <h2 id="ai-budget-title">Gasto y presupuesto</h2>
        <p>
          Lo gastado en IA {month ? `en ${monthName(month)}` : "este mes"}, en tokens (o caracteres, en DeepL y Azure) y en dólares estimados con
          la tabla de precios de abajo. Al llegar a un límite se termina la sección o el documento en curso y se para
          antes del siguiente.
        </p>
      </div>

      <section aria-labelledby="ai-budget-month" className={styles.block}>
        <h3 id="ai-budget-month">Este mes</h3>
        {providersInUse.length ? (
          <table className={styles.usage}>
            <thead>
              <tr>
                <th scope="col">Proveedor</th>
                <th scope="col">Uso</th>
                <th scope="col">Estimado</th>
              </tr>
            </thead>
            <tbody>
              {providersInUse.map((provider) => {
                const entry = spend.byProvider[provider];
                const check = checkBudget(spend, settings.budget, provider);
                const units = characterProviders.includes(provider as BudgetProvider)
                  ? `${number(entry?.characters ?? 0)} caracteres`
                  : `${number(entry?.tokens ?? 0)} tokens`;
                return (
                  <tr data-level={check.level} key={provider}>
                    <th scope="row">{budgetProviderNames[provider] ?? provider}</th>
                    <td>{units}</td>
                    <td>{isBudgetProvider(provider) ? money(entry?.usd ?? 0) : "Gratis"}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr data-level={overall.level}>
                <th scope="row">Total de los que cobran</th>
                <td>{number(spend.tokens)} tokens</td>
                <td>{money(spend.usd)}</td>
              </tr>
            </tfoot>
          </table>
        ) : (
          <p className={styles.note}>Todavía no has usado ninguna IA este mes.</p>
        )}
        {overall.level !== "ok" ? (
          <p className={styles.alert} data-level={overall.level} role="status">
            {budgetMessage(overall, month ?? monthKey())}
          </p>
        ) : null}
        {missing.length ? (
          <p className={styles.note}>
            Sin precio en la tabla: {missing.join(", ")}. Sus tokens cuentan, pero no suman dólares hasta que le
            pongas precio.
          </p>
        ) : null}
        <p className={styles.note}>
          {usage.others
            ? `Incluye lo de ${usage.others === 1 ? "otro equipo" : `${usage.others} equipos más`} de tu cuenta: cada uno sube su contador y aquí se suman.`
            : "Se cuenta en este equipo. Con la cuenta y la sincronización, se suma lo de tus otros equipos."}{" "}
          Ollama y LibreTranslate se cuentan, pero no tienen límite: son gratis.
        </p>
      </section>

      <form className={styles.form} onSubmit={save}>
        <section aria-labelledby="ai-budget-limits" className={styles.block}>
          <h3 id="ai-budget-limits">Límites del mes</h3>
          <p className={styles.note}>Vacío es sin límite. Se avisa al 80 %.</p>
          <div className={styles.pair}>
            <Field label="Dólares al mes, en total" labelFor="budget-usd">
              <Input
                id="budget-usd"
                inputMode="decimal"
                onChange={(event) => {
                  const value = event.target.value;
                  setDraft((current) => ({ ...current, monthlyUsd: value }));
                }}
                placeholder="Sin límite"
                value={draft.monthlyUsd}
              />
            </Field>
            <Field label="Tokens al mes, en total" labelFor="budget-tokens">
              <Input
                id="budget-tokens"
                inputMode="numeric"
                onChange={(event) => {
                  const value = event.target.value;
                  setDraft((current) => ({ ...current, monthlyTokens: value }));
                }}
                placeholder="Sin límite"
                value={draft.monthlyTokens}
              />
            </Field>
          </div>
          <table className={styles.limits}>
            <caption className={styles.caption}>Por proveedor</caption>
            <thead>
              <tr>
                <th scope="col">Proveedor</th>
                <th scope="col">Dólares</th>
                <th scope="col">Tokens o caracteres</th>
              </tr>
            </thead>
            <tbody>
              {budgetProviders.map((provider) => {
                const name = budgetProviderNames[provider] ?? provider;
                const unit = characterProviders.includes(provider) ? "caracteres" : "tokens";
                return (
                  <tr key={provider}>
                    <th scope="row">{name}</th>
                    <td>
                      <Input
                        aria-label={`Dólares al mes con ${name}`}
                        inputMode="decimal"
                        onChange={(event) => setProvider(provider, "usd", event.target.value)}
                        placeholder="—"
                        value={draft.providers[provider]?.usd ?? ""}
                      />
                    </td>
                    <td>
                      <Input
                        aria-label={`${unit === "tokens" ? "Tokens" : "Caracteres"} al mes con ${name}`}
                        inputMode="numeric"
                        onChange={(event) => setProvider(provider, "units", event.target.value)}
                        placeholder="—"
                        value={draft.providers[provider]?.units ?? ""}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section aria-labelledby="ai-budget-prices" className={styles.block}>
          <h3 id="ai-budget-prices">Precios</h3>
          <p className={styles.note}>
            Dólares por millón de tokens, de la documentación de cada proveedor. Los de partida se revisaron el
            29-sep-2026; cámbialos si tu proveedor cobra otra cosa. Un modelo sin precio cuenta tokens, no dólares.
          </p>
          <table className={styles.limits}>
            <thead>
              <tr>
                <th scope="col">Modelo</th>
                <th scope="col">Entrada</th>
                <th scope="col">Salida</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ key, prices }) => {
                const [provider = "", ...rest] = key.split(":");
                const model = rest.join(":");
                const label = `${model} (${budgetProviderNames[provider] ?? provider})`;
                return (
                  <tr key={key}>
                    <th scope="row">{label}</th>
                    <td>
                      <Input
                        aria-label={`Precio de entrada de ${label}`}
                        inputMode="decimal"
                        onChange={(event) => setPrice(key, "input", event.target.value)}
                        placeholder="Sin precio"
                        value={prices.input}
                      />
                    </td>
                    <td>
                      <Input
                        aria-label={`Precio de salida de ${label}`}
                        inputMode="decimal"
                        onChange={(event) => setPrice(key, "output", event.target.value)}
                        placeholder="Sin precio"
                        value={prices.output}
                      />
                    </td>
                  </tr>
                );
              })}
              {characterProviders.map((provider) => {
                const name = budgetProviderNames[provider] ?? provider;
                return (
                  <tr key={provider}>
                    <th scope="row">{name} (por millón de caracteres)</th>
                    <td colSpan={2}>
                      <Input
                        aria-label={`Precio por millón de caracteres de ${name}`}
                        inputMode="decimal"
                        onChange={(event) => {
                          const value = event.target.value;
                          setDraft((current) => ({ ...current, characterPrices: { ...current.characterPrices, [provider]: value } }));
                        }}
                        placeholder="Sin precio"
                        value={draft.characterPrices[provider] ?? ""}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <div className={styles.actions}>
          <Button type="submit">Guardar presupuesto</Button>
          <p aria-live="polite" className={styles.note} role="status">
            {saved}
          </p>
        </div>
      </form>
    </Card>
  );
}

import {
  providerPlace,
  routeFor,
  sensitiveFlows,
  sensitivityLevels,
  type ProviderPlace,
  type SensitiveFlow,
  type Sensitivity,
} from "../library/sensitivity";
import { askModelOf, askProviderOf, indexProviderOf, type AiSettings } from "./ai-settings";
import { embeddingModels } from "./embeddings";

/**
 * El router proveedor × flujo × sensibilidad (04.3), en una tabla: para cada flujo que puede
 * sacar el texto de un libro del equipo, quién lo hace, dónde y qué pasa con un libro de cada
 * nivel. Es lo mismo que deciden `routeFor` y `providerPlace` en el momento de enviar; aquí se
 * enseña antes, para que nadie se lleve una sorpresa.
 *
 * Sin respaldo automático (decisión `f8c90d3b`): si el proveedor de un flujo falla, Pliegue no
 * prueba con otro por su cuenta. Lo dice y la persona elige. Así un libro nunca acaba en un
 * proveedor que no eligió.
 */

/** Qué pasa con un libro: se hace en el equipo, sale, se pregunta antes, no sale o no se hace. */
export type RouteOutcome = "local" | "allow" | "ask" | "block" | "off";

export interface FlowRoute {
  /** Quién lo hace: un proveedor de IA, un traductor o el navegador; null si no lo hace nadie. */
  engine: string | null;
  engineName: string;
  flow: SensitiveFlow;
  model: string | null;
  outcomes: Record<Sensitivity, RouteOutcome>;
  place: ProviderPlace | null;
  /** Dónde, en palabras: «En este equipo», «En tu servidor de Ollama», «En la nube de OpenAI»… */
  where: string;
}

export const flowTitles: Record<SensitiveFlow, string> = {
  ask: "Preguntar",
  catalog: "Catalogar",
  index: "Buscar por significado",
  translate: "Traducir",
};

/** Qué sale en cada flujo: la razón de que cada uno tenga su permiso. */
export const flowSends: Record<SensitiveFlow, string> = {
  ask: "los fragmentos que responden",
  catalog: "un extracto",
  index: "el texto entero, en fragmentos",
  translate: "el texto de lo que se traduce",
};

export const engineNames: Record<string, string> = {
  anthropic: "Claude",
  azure: "Azure Translator",
  browser: "Traductor de Chrome o Edge",
  deepl: "DeepL",
  gemini: "Gemini",
  libretranslate: "LibreTranslate",
  ollama: "Ollama",
  openai: "OpenAI",
};

const llmEngines = new Set(["anthropic", "gemini", "ollama", "openai"]);

/** Quién hace un flujo y con qué modelo. */
export function flowEngine(settings: AiSettings, flow: SensitiveFlow): { engine: string | null; model: string | null } {
  if (flow === "catalog") return { engine: settings.provider, model: settings.models[settings.provider] };
  if (flow === "translate") {
    const engine = settings.translationProvider;
    return { engine, model: llmEngines.has(engine) ? settings.translationModels[engine as keyof AiSettings["translationModels"]] : null };
  }
  if (flow === "index") {
    const provider = indexProviderOf(settings);
    const model = provider ? embeddingModels[provider] : null;
    return provider && model ? { engine: provider, model } : { engine: null, model: null };
  }
  return { engine: askProviderOf(settings), model: askModelOf(settings) };
}

function whereOf(engine: string, place: ProviderPlace, settings: AiSettings) {
  if (place === "device") return "En este equipo";
  if (engine === "ollama") return "En tu servidor de Ollama";
  if (engine === "libretranslate") {
    try {
      return `En ${new URL(settings.libreTranslateUrl).host}`;
    } catch {
      return "En tu LibreTranslate";
    }
  }
  if (engine === "azure") return `En la nube de Azure${settings.azureRegion ? ` (${settings.azureRegion})` : ", región global"}`;
  return `En la nube de ${engineNames[engine] ?? engine}`;
}

/** La tabla entera: un flujo por fila y, en cada una, qué pasa con cada nivel. */
export function routerMatrix(settings: AiSettings): FlowRoute[] {
  return sensitiveFlows.map((flow) => {
    const { engine, model } = flowEngine(settings, flow);
    if (!engine) {
      const outcomes = Object.fromEntries(sensitivityLevels.map((level) => [level, "off"])) as Record<Sensitivity, RouteOutcome>;
      return { engine: null, engineName: "Nadie", flow, model: null, outcomes, place: null, where: "Nada sale del equipo" };
    }
    const place = providerPlace(engine, settings);
    const outcomes = Object.fromEntries(
      sensitivityLevels.map((level) => [level, place === "device" ? "local" : routeFor(level, place, false)]),
    ) as Record<Sensitivity, RouteOutcome>;
    return { engine, engineName: engineNames[engine] ?? engine, flow, model, outcomes, place, where: whereOf(engine, place, settings) };
  });
}

/** Lo que pasa, en palabras de cada flujo. */
export function outcomeLabel(flow: SensitiveFlow, outcome: RouteOutcome) {
  switch (outcome) {
    case "local":
      return "En el equipo";
    case "allow":
      return "Sale";
    case "ask":
      return "Pregunta una vez";
    case "off":
      return flow === "index" ? "Solo por palabras" : "No se hace";
    case "block":
      return flow === "catalog"
        ? "No sale: sin ficha"
        : flow === "translate"
          ? "No sale: se ofrece el equipo"
          : flow === "index"
            ? "No sale: solo por palabras"
            : "No sale: se enseña aparte";
  }
}

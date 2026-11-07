import type { LibraryDocument } from "./documents";

/**
 * Sensibilidad de los libros (04.3, decisión del 6-nov): los cuatro niveles de
 * 01-product-scope §4.3. Se marca en la fuente (carpeta, Drive, archivos sueltos, copias) y la
 * heredan sus libros; cada libro puede cambiarla. Sin marcar, «interno»: nada cambia.
 *
 * - Público e interno: como siempre, con el proveedor de cada flujo.
 * - Personal: la primera vez que un libro va a salir del equipo en un flujo (catalogar,
 *   traducir), se pregunta, y se recuerda. No en cada envío: traducir son cientos de páginas.
 * - Confidencial: solo en el equipo (Ollama en este equipo o el traductor del navegador). Con un
 *   proveedor en la nube se bloquea y se ofrece hacerlo en el equipo.
 */

export const sensitivityLevels = ["publico", "interno", "personal", "confidencial"] as const;
export type Sensitivity = (typeof sensitivityLevels)[number];
export const defaultSensitivity: Sensitivity = "interno";

export const sensitivityNames: Record<Sensitivity, string> = {
  confidencial: "Confidencial",
  interno: "Interno",
  personal: "Personal",
  publico: "Público",
};

export const sensitivityHelp: Record<Sensitivity, string> = {
  confidencial: "Solo en este equipo: con Ollama o el traductor del navegador. Nunca a un proveedor en la nube.",
  interno: "Como hasta ahora: cada flujo usa el proveedor que elegiste.",
  personal: "Antes de enviarlo a un proveedor en la nube, se pregunta una vez por libro y flujo.",
  publico: "Sin restricciones: cada flujo usa el proveedor que elegiste.",
};

export function isSensitivity(value: unknown): value is Sensitivity {
  return (sensitivityLevels as readonly unknown[]).includes(value);
}

/**
 * Los flujos que pueden mandar el texto de un libro fuera del equipo. Indexar (04.4) manda el
 * texto entero, en fragmentos, para calcular sus embeddings: pide su propio permiso.
 */
export const sensitiveFlows = ["catalog", "translate", "index"] as const;
export type SensitiveFlow = (typeof sensitiveFlows)[number];

export const flowNames: Record<SensitiveFlow, string> = {
  catalog: "catalogar",
  index: "indexar",
  translate: "traducir",
};

export function isSensitiveFlow(value: unknown): value is SensitiveFlow {
  return (sensitiveFlows as readonly unknown[]).includes(value);
}

/** De qué fuente sale un libro, para heredar su sensibilidad. */
export function sourceKeyOf(document: Pick<LibraryDocument, "reference">): string {
  const reference = document.reference;
  if (reference.kind === "local-folder") return `folder:${reference.sourceId}`;
  if (reference.kind === "local-file") return "files";
  if (reference.kind === "local-copy") return "copies";
  const sourceId = (document as { sourceId?: unknown }).sourceId;
  return typeof sourceId === "string" && sourceId ? `drive:${sourceId}` : "drive-files";
}

export interface SensitivityMarks {
  /** Lo marcado en cada libro (por su id en este equipo). */
  documents: Record<string, Sensitivity>;
  /** Lo marcado en cada fuente (`sourceKeyOf`). */
  sources: Record<string, Sensitivity>;
}

/** La sensibilidad que vale para un libro: la suya, o la de su fuente, o «interno». */
export function effectiveSensitivity(document: Pick<LibraryDocument, "id" | "reference">, marks: SensitivityMarks): Sensitivity {
  return marks.documents[document.id] ?? marks.sources[sourceKeyOf(document)] ?? defaultSensitivity;
}

/** Dónde trabaja un motor: en este equipo o fuera. */
export type ProviderPlace = "device" | "cloud";

/**
 * Qué hacer antes de mandar un libro a un motor: seguir, preguntar (personal, sin permiso aún)
 * o no hacerlo (confidencial, fuera del equipo).
 */
export function routeFor(level: Sensitivity, place: ProviderPlace, consented: boolean): "allow" | "ask" | "block" {
  if (place === "device") return "allow";
  if (level === "confidencial") return "block";
  if (level === "personal" && !consented) return "ask";
  return "allow";
}

const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Una dirección de este mismo equipo (http://localhost:…): lo que va allí no sale. */
export function isLoopbackUrl(url: string) {
  try {
    const host = new URL(url).hostname;
    return loopbackHosts.has(host) || host.endsWith(".localhost");
  } catch {
    return false;
  }
}

/**
 * Dónde trabaja el proveedor de un flujo. Ollama en modo local y un LibreTranslate en este
 * equipo no sacan nada; Ollama remoto, sí. El traductor del navegador es del equipo.
 */
export function providerPlace(
  provider: string,
  settings: { libreTranslateUrl: string; ollamaMode: "local" | "remote"; ollamaUrl: string },
): ProviderPlace {
  if (provider === "browser") return "device";
  // Por la dirección y no por el modo: en modo local la URL ya es `localhost`, y si no lo fuera,
  // el texto saldría del equipo (con 04.4, el libro entero).
  if (provider === "ollama") return isLoopbackUrl(settings.ollamaUrl) ? "device" : "cloud";
  if (provider === "libretranslate") return isLoopbackUrl(settings.libreTranslateUrl) ? "device" : "cloud";
  return "cloud";
}

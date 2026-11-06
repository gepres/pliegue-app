import { Tag } from "@pliegue/ui";

import type { CapabilitySupport, ModelCapabilities } from "../ai/model-capabilities";
import styles from "../(workspace)/app/workspace.module.css";

function capabilityLabel(label: string, support: CapabilitySupport) {
  return support === true ? label : `${label}: ${support === false ? "no" : "sin confirmar"}`;
}

function tokenLabel(tokens: number) {
  const divisor = tokens >= 1_000_000 ? 1_000_000 : tokens >= 1_000 ? 1_000 : 1;
  const value = (tokens / divisor).toLocaleString("es", { maximumFractionDigits: 1 });
  return `${value}${divisor === 1_000_000 ? " M" : divisor === 1_000 ? " k" : ""}`;
}

/** Capacidades del modelo probado; informa sin impedir guardar los ajustes. */
export function ModelCapabilityTags({ capabilities }: { capabilities: ModelCapabilities }) {
  return (
    <div aria-label="Capacidades del modelo" aria-live="polite" className={styles.aiModelCapabilities} role="group">
      <Tag>{capabilityLabel("Salida JSON", capabilities.structuredOutput)}</Tag>
      <Tag>{capabilityLabel("Imágenes", capabilities.vision)}</Tag>
      <Tag>{capabilityLabel("Embeddings", capabilities.embeddings)}</Tag>
      {capabilities.contextTokens !== undefined ? (
        <Tag title={`${capabilities.contextTokens.toLocaleString("es")} tokens`}>Contexto {tokenLabel(capabilities.contextTokens)}</Tag>
      ) : null}
      {capabilities.maxOutputTokens !== undefined ? (
        <Tag title={`${capabilities.maxOutputTokens.toLocaleString("es")} tokens`}>Salida máxima {tokenLabel(capabilities.maxOutputTokens)}</Tag>
      ) : null}
      {capabilities.structuredOutput === false ? (
        <p className={styles.aiCapabilityWarning} role="alert">
          Este modelo no admite salida JSON estructurada. Catalogar y traducir con IA no funcionarán
          con este modelo. Puedes guardar los ajustes igualmente.
        </p>
      ) : null}
    </div>
  );
}

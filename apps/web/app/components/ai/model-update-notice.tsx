"use client";

import { useState, useSyncExternalStore } from "react";

import { Button } from "@pliegue/ui";

import { catalogProviderNames } from "../../ai/ai-readiness";
import { currentAiSettings, saveAiSettings, storedLegacyModelChanges } from "../../ai/ai-settings-store";
import styles from "./ollama-model.module.css";

const noSubscription = () => () => {};
const serverChanges: ReturnType<typeof storedLegacyModelChanges> = [];
let cachedKey = "";
let cached: ReturnType<typeof storedLegacyModelChanges> = [];

/** Lo guardado, leído una vez por cambio: `useSyncExternalStore` pide la misma referencia. */
function readChanges() {
  const changes = storedLegacyModelChanges();
  const key = JSON.stringify(changes);
  if (key !== cachedKey) {
    cachedKey = key;
    cached = changes;
  }
  return cached;
}

/**
 * Los modelos de partida pasaron a los nuevos, más baratos (04.2b): quien seguía con los de antes
 * ya usa los de ahora, y se le dice una vez. «Entendido» guarda los ajustes, y el aviso se va.
 */
export function ModelUpdateNotice() {
  const changes = useSyncExternalStore(noSubscription, readChanges, () => serverChanges);
  const [dismissed, setDismissed] = useState(false);
  if (dismissed || !changes.length) return null;
  return (
    <div className={styles.box} role="status">
      <p className={styles.note}>
        <strong>Modelos al día.</strong> Tus modelos de partida pasan a los nuevos, más baratos (precios del 6 de
        noviembre):{" "}
        {changes
          .map(
            (change) =>
              `${change.from} → ${change.to} (${catalogProviderNames[change.provider]}, ${change.kind === "models" ? "catalogar" : "traducir"})`,
          )
          .join("; ")}
        .
      </p>
      <div className={styles.row}>
        <Button
          onClick={() => {
            saveAiSettings(currentAiSettings());
            setDismissed(true);
          }}
          size="sm"
          type="button"
          variant="secondary"
        >
          Entendido
        </Button>
      </div>
    </div>
  );
}

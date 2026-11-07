"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { Button } from "@pliegue/ui";

import { ollamaHasModel, pullOllamaModel, recommendedOllamaModel, type PullProgress } from "../../ai/ollama-pull";
import styles from "./ollama-model.module.css";

type State =
  | { kind: "checking" }
  | { kind: "installed" }
  | { kind: "missing" }
  | { kind: "unreachable" }
  | { kind: "pulling"; progress: PullProgress }
  | { kind: "error"; message: string };

const noSubscription = () => () => {};
/** `deviceMemory` lo da Chrome redondeado (máximo 8): menos de 8 GB es un equipo justo. */
const readLowMemory = () => {
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return typeof memory === "number" && memory < 8;
};

const gb = (value: number) => `${value.toLocaleString("es", { maximumFractionDigits: 1 })} GB`;

/**
 * Ajustes → IA, con Ollama (04.2b): el modelo recomendado, si el elegido está descargado y, si no,
 * un botón que lo descarga con su avance. Sin terminal: le habla a Ollama desde el navegador.
 */
export function OllamaModel({ model, url }: { model: string; url: string }) {
  const [state, setState] = useState<State>({ kind: "checking" });
  const lowMemory = useSyncExternalStore(noSubscription, readLowMemory, () => false);
  const [check, setCheck] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const trimmed = model.trim();
    if (!trimmed) return;
    const controller = new AbortController();
    // Mientras se escribe la dirección o el modelo, se espera un momento antes de preguntar.
    const timer = window.setTimeout(() => {
      setState({ kind: "checking" });
      void ollamaHasModel(url, trimmed, controller.signal)
        .then((has) => setState({ kind: has === null ? "unreachable" : has ? "installed" : "missing" }))
        .catch(() => undefined);
    }, 400);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [check, model, url]);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function download() {
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ kind: "pulling", progress: { fraction: null, status: "Preparando la descarga…" } });
    try {
      await pullOllamaModel(url, model.trim(), (progress) => setState({ kind: "pulling", progress }), controller.signal);
      setCheck((value) => value + 1);
    } catch (error) {
      if (controller.signal.aborted) {
        setState({ kind: "missing" });
        return;
      }
      setState({ kind: "error", message: error instanceof Error ? error.message : "No se pudo descargar el modelo." });
    } finally {
      abortRef.current = null;
    }
  }

  const recommended = model.trim() === recommendedOllamaModel.name;

  return (
    <div className={styles.box}>
      <p className={styles.note}>
        <strong>Recomendado: {recommendedOllamaModel.name}.</strong> Gratis y en tu equipo; cataloga y traduce bien.
        Pesa unos {gb(recommendedOllamaModel.sizeGb)} y va bien con {recommendedOllamaModel.memoryGb}&nbsp;GB de memoria.
        {lowMemory ? " Este equipo tiene poca memoria: con qwen3:4b (unos 2,5 GB) irá más suelto." : ""}
      </p>
      {state.kind === "installed" ? (
        <p className={styles.ok} role="status">
          {model} ya está descargado en Ollama.
        </p>
      ) : state.kind === "missing" ? (
        <div className={styles.row}>
          <p className={styles.note} role="status">
            {model} no está en tu Ollama.
          </p>
          <Button onClick={() => void download()} size="sm" type="button" variant="secondary">
            Descargar {model}
            {recommended ? ` (≈${gb(recommendedOllamaModel.sizeGb)})` : ""}
          </Button>
        </div>
      ) : state.kind === "pulling" ? (
        <div className={styles.pull}>
          <div className={styles.row}>
            <p className={styles.note} role="status">
              {state.progress.status}
              {state.progress.fraction !== null ? ` ${Math.floor(state.progress.fraction * 100)} %` : ""}
            </p>
            <Button onClick={() => abortRef.current?.abort()} size="sm" type="button" variant="quiet">
              Cancelar
            </Button>
          </div>
          <div
            aria-label={`Descarga de ${model}`}
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={state.progress.fraction !== null ? Math.floor(state.progress.fraction * 100) : undefined}
            className={styles.track}
            role="progressbar"
          >
            <span data-indeterminate={state.progress.fraction === null || undefined} style={{ width: `${Math.round((state.progress.fraction ?? 0.3) * 100)}%` }} />
          </div>
        </div>
      ) : state.kind === "unreachable" ? (
        <p className={styles.note} role="status">
          Ollama no responde en {url}: ábrelo (se instala desde ollama.com) y deja que esta web lo use (OLLAMA_ORIGINS). Luego{" "}
          <button className={styles.link} onClick={() => setCheck((value) => value + 1)} type="button">
            vuelve a comprobarlo
          </button>
          .
        </p>
      ) : state.kind === "error" ? (
        <p className={styles.error} role="alert">
          {state.message}
        </p>
      ) : (
        <p className={styles.note} role="status">
          Comprobando si {model} está descargado…
        </p>
      )}
    </div>
  );
}

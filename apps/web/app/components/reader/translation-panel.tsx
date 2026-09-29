"use client";

import Link from "next/link";
import { useState } from "react";

import { Button, Field, Select } from "@pliegue/ui";

import {
  languageName,
  translationTargets,
  type TranslationPair,
} from "../../library/translation";
import type { TranslationSnapshot } from "../../library/translation-session";
import { Segmented } from "../app-ui/controls";
import type { TranslationView } from "./translation-view";
import type { TranslationEngineKind, TranslationPhase } from "./use-book-translation";
import styles from "./translation-panel.module.css";

/** Idiomas de origen que se ofrecen: los de los libros que suelen llegar a una biblioteca en español. */
const sourceLanguages = ["en", "es", "fr", "pt", "it", "de", "ca", "nl", "ru", "zh", "ja", "ko"] as const;

function rangeLabel(pages: readonly number[]) {
  if (pages.length === 0) return "";
  const first = pages[0];
  const last = pages.at(-1);
  return first === last ? `la ${first}` : `de la ${first} a la ${last}`;
}

/**
 * Traducir el libro que se está leyendo: idiomas, avance y qué se está preparando. El motor es
 * el del propio navegador, en el dispositivo; el texto no sale del equipo.
 */
/** «las cinco siguientes», «las dos siguientes»: el número de lo que se prepara por delante. */
function aheadLabel(count: number, noun: { plural: string; singular: string }) {
  const words: Record<number, string> = { 1: "la siguiente", 2: "las dos siguientes", 3: "las tres siguientes", 5: "las cinco siguientes" };
  return words[count] ?? `las ${count} ${noun.plural} siguientes`;
}

/** Lo que el panel cuenta de «Tu IA»: qué proveedor y modelo, y si falta la clave. */
export interface AiEngineSummary {
  /** En Ajustes se eligió con qué IA traducir; si no, sigue el traductor del navegador. */
  configured: boolean;
  /** «Gemini · gemini-3.5-flash-lite». */
  label: string;
  needsKey: boolean;
  onDevice: boolean;
  provider: string;
}

export function TranslationPanel({
  ahead,
  aiEngine,
  browserSupported,
  engineKind,
  onEngineChange,
  onClear,
  onRetry,
  onStart,
  onStop,
  onViewChange,
  pair,
  parallelAvailable,
  phase,
  snapshot,
  sourceGuess,
  unitCount,
  unitNoun,
  view,
}: {
  /** Cuántas unidades se preparan por delante de la que se lee. */
  ahead: number;
  aiEngine: AiEngineSummary;
  /** Hay traductor integrado en este navegador. */
  browserSupported: boolean;
  engineKind: TranslationEngineKind;
  onEngineChange: (kind: TranslationEngineKind) => void;
  onClear: () => Promise<void>;
  onRetry: () => void;
  onStart: (pair: TranslationPair, engine: TranslationEngineKind) => void;
  onStop: () => void;
  onViewChange: (view: TranslationView) => void;
  pair: TranslationPair | null;
  /** La pantalla es ancha: cabe la traducción al lado del original. */
  parallelAvailable: boolean;
  phase: TranslationPhase;
  snapshot: TranslationSnapshot;
  sourceGuess: string | null;
  unitCount: number;
  /** «páginas» o «secciones». */
  unitNoun: { plural: string; singular: string };
  view: TranslationView;
}) {
  const initialSource = pair?.source ?? sourceGuess ?? "en";
  const [source, setSource] = useState(initialSource);
  const [target, setTarget] = useState(pair?.target ?? (initialSource === "es" ? "en" : "es"));
  const [confirmClear, setConfirmClear] = useState(false);
  const active = phase.kind === "ready";
  const busy = phase.kind === "checking" || phase.kind === "downloading";
  const sameLanguage = source === target;
  const usingAi = engineKind === "ai";
  const aiUnset = usingAi && !aiEngine.configured;
  const aiNeedsKey = usingAi && aiEngine.configured && aiEngine.needsKey;
  const engineName = usingAi ? `Tu IA · ${aiEngine.label}` : "Traductor del navegador";
  const sources = sourceLanguages.includes(source as (typeof sourceLanguages)[number]) ? sourceLanguages : [source, ...sourceLanguages];

  return (
    <div className={styles.panel}>
      <div className={styles.engine}>
        {active || busy ? (
          <p className={styles.engineNow}>
            <span>Motor</span>
            <strong>{engineName}</strong>
          </p>
        ) : (
          <Segmented<TranslationEngineKind>
            label="Motor de traducción"
            onChange={onEngineChange}
            options={[
              { label: "Navegador", value: "browser" },
              { label: "Tu IA", value: "ai" },
            ]}
            size="sm"
            value={engineKind}
          />
        )}
        <p className={styles.hint}>
          {aiUnset ? (
            <>
              Aún no has elegido con qué IA traducir: Azure, OpenAI, Claude, Gemini u Ollama.{" "}
              <Link href="/app/ajustes#ia">Elegir y comparar en Ajustes</Link>
            </>
          ) : usingAi ? (
            aiEngine.onDevice ? (
              <>
                {aiEngine.label}, en tu equipo: el texto no sale de él.{" "}
                <Link href="/app/ajustes#ia">Cambiar en Ajustes</Link>
              </>
            ) : (
              <>
                {aiEngine.label} con tu clave: el texto de cada página va a {aiEngine.provider} y lo
                factura tu cuenta. <Link href="/app/ajustes#ia">Cambiar en Ajustes</Link>
              </>
            )
          ) : browserSupported ? (
            <>
              Gratis y privado: traduce en este dispositivo, con el traductor de Chrome o Edge.{" "}
              <Link href="/app/ajustes#ia">¿Cuál conviene?</Link>
            </>
          ) : (
            <>
              Este navegador no trae traductor integrado: solo Chrome y Edge de escritorio. Con «Tu IA» se
              traduce en cualquiera. <Link href="/app/ajustes#ia">Elegir en Ajustes</Link>
            </>
          )}
        </p>
        {aiNeedsKey && phase.kind !== "ready" ? (
          <p className={styles.notice} role="status">
            Falta la clave de {aiEngine.provider} en esta sesión: se guarda solo mientras la
            pestaña está abierta. <Link href="/app/ajustes#ia">Ponla en Ajustes</Link>
          </p>
        ) : null}
      </div>

      <div className={styles.languages}>
        <Field
          {...(source === sourceGuess ? { description: "Detectado en el libro" } : {})}
          label="Idioma del libro"
          labelFor="translation-source"
        >
          <Select
            disabled={active || busy}
            id="translation-source"
            onChange={(event) => setSource(event.target.value)}
            value={source}
          >
            {sources.map((code) => (
              <option key={code} value={code}>
                {languageName(code)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Traducir al" labelFor="translation-target">
          <Select
            disabled={active || busy}
            id="translation-target"
            onChange={(event) => setTarget(event.target.value)}
            value={target}
          >
            {translationTargets.map((code) => (
              <option key={code} value={code}>
                {languageName(code)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {phase.kind === "ready" ? (
        <>
          <div className={styles.progress}>
            <div className={styles.progressHead}>
              <strong>Traducido {snapshot.percent} %</strong>
              <span>
                {snapshot.done} de {unitCount} {unitNoun.plural}
              </span>
            </div>
            <div aria-hidden="true" className={styles.bar}>
              <span style={{ transform: `scaleX(${snapshot.percent / 100})` }} />
            </div>
            <p aria-live="polite" className={styles.status}>
              {snapshot.error
                ? `Se detuvo: ${snapshot.error}`
                : snapshot.working !== null
                  ? `Traduciendo la ${unitNoun.singular} ${snapshot.working}${
                      snapshot.pending.length ? `; después, ${rangeLabel(snapshot.pending)}` : ""
                    }.`
                  : "Al día: las siguientes páginas ya están listas mientras lees."}
            </p>
            {snapshot.error ? (
              <Button onClick={onRetry} size="sm" variant="secondary">
                Reintentar
              </Button>
            ) : null}
          </div>
          <Segmented<TranslationView>
            label="Qué se muestra"
            onChange={onViewChange}
            options={[
              { label: "Traducción", value: "translated" },
              ...(parallelAvailable ? [{ label: "En paralelo", value: "parallel" as const }] : []),
              { label: "Original", value: "original" },
            ]}
            size="sm"
            value={view}
          />
          {view === "parallel" ? (
            <p className={styles.hint}>
              El original a la izquierda y la traducción a la derecha. Pasa el ratón por una frase
              o selecciónala y se resalta su pareja en el otro lado. La tecla P vuelve a la
              traducción sola.
            </p>
          ) : null}
          <div className={styles.actions}>
            <Button onClick={onStop} size="sm" variant="secondary">
              Detener
            </Button>
            {confirmClear ? (
              <span className={styles.confirm}>
                <span>¿Borrar lo traducido?</span>
                <Button
                  onClick={() => {
                    setConfirmClear(false);
                    void onClear();
                  }}
                  size="sm"
                  variant="danger"
                >
                  Sí, borrar
                </Button>
                <Button onClick={() => setConfirmClear(false)} size="sm" variant="quiet">
                  Cancelar
                </Button>
              </span>
            ) : (
              <Button onClick={() => setConfirmClear(true)} size="sm" variant="quiet">
                Borrar traducción
              </Button>
            )}
          </div>
        </>
      ) : phase.kind === "downloading" ? (
        <div className={styles.progress}>
          <div className={styles.progressHead}>
            <strong>Descargando el idioma</strong>
            <span>{phase.fraction > 0 ? `${Math.round(phase.fraction * 100)} %` : "…"}</span>
          </div>
          {/* Hay pares para los que el navegador solo avisa al empezar y al terminar: sin avance
              que enseñar, la barra dice que sigue en marcha en lugar de quedarse quieta. */}
          <div aria-hidden="true" className={styles.bar} data-indeterminate={phase.fraction > 0 ? undefined : "true"}>
            <span style={phase.fraction > 0 ? { transform: `scaleX(${phase.fraction})` } : undefined} />
          </div>
          <p className={styles.status}>
            Una sola vez: el paquete de {languageName(source)} → {languageName(target)} ocupa unas
            decenas de megas y se queda en el navegador.
          </p>
        </div>
      ) : (
        <>
          {phase.kind === "unsupported" ? (
            <p className={styles.notice} role="alert">
              Este navegador no trae traductor integrado: funciona en Chrome y Edge de escritorio.
              Aquí puedes traducir con «Tu IA», usando tu propia clave.
            </p>
          ) : phase.kind === "unavailable" ? (
            <p className={styles.notice} role="alert">
              {usingAi
                ? "Elige dos idiomas distintos."
                : `El traductor del navegador no ofrece ${languageName(source)} → ${languageName(target)}. Prueba con otro par de idiomas o con «Tu IA».`}
            </p>
          ) : phase.kind === "error" ? (
            <p className={styles.notice} role="alert">
              {phase.message}
            </p>
          ) : null}
          <Button
            disabled={busy || sameLanguage || unitCount <= 0 || aiUnset || aiNeedsKey || (!usingAi && !browserSupported)}
            onClick={() => onStart({ source, target }, engineKind)}
          >
            {phase.kind === "checking" ? "Comprobando el traductor…" : pair ? "Seguir traduciendo" : "Traducir este libro"}
          </Button>
          <p className={styles.hint}>
            {sameLanguage
              ? "El libro ya está en ese idioma."
              : `${aiUnset ? "Cuando elijas una IA en Ajustes, se traducirá con ella" : usingAi ? `Se traduce con ${aiEngine.label}` : "Se traduce en este dispositivo con el traductor del navegador: el texto no sale del equipo"}. Primero la ${unitNoun.singular} que lees y, mientras tanto, ${aheadLabel(ahead, unitNoun)}.`}
          </p>
        </>
      )}

      <p className={styles.rights}>
        {usingAi && !aiEngine.onDevice
          ? "Traducción automática para tu lectura: puede tener errores y se guarda solo en este dispositivo."
          : "Traducción automática, hecha en tu dispositivo para tu lectura: puede tener errores y se guarda solo aquí."}
      </p>
    </div>
  );
}

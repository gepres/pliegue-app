"use client";

import { useState } from "react";

import { Button, Field, Select } from "@pliegue/ui";

import {
  languageName,
  translationTargets,
  type TranslationPair,
} from "../../library/translation";
import type { TranslationSnapshot } from "../../library/translation-session";
import { Segmented } from "../app-ui/controls";
import type { TranslationPhase } from "./use-book-translation";
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

export function TranslationPanel({
  ahead,
  onClear,
  onRetry,
  onStart,
  onStop,
  onVisibleChange,
  pair,
  phase,
  snapshot,
  sourceGuess,
  unitCount,
  unitNoun,
  visible,
}: {
  /** Cuántas unidades se preparan por delante de la que se lee. */
  ahead: number;
  onClear: () => Promise<void>;
  onRetry: () => void;
  onStart: (pair: TranslationPair) => void;
  onStop: () => void;
  onVisibleChange: (visible: boolean) => void;
  pair: TranslationPair | null;
  phase: TranslationPhase;
  snapshot: TranslationSnapshot;
  sourceGuess: string | null;
  unitCount: number;
  /** «páginas» o «secciones». */
  unitNoun: { plural: string; singular: string };
  visible: boolean;
}) {
  const initialSource = pair?.source ?? sourceGuess ?? "en";
  const [source, setSource] = useState(initialSource);
  const [target, setTarget] = useState(pair?.target ?? (initialSource === "es" ? "en" : "es"));
  const [confirmClear, setConfirmClear] = useState(false);
  const active = phase.kind === "ready";
  const busy = phase.kind === "checking" || phase.kind === "downloading";
  const sameLanguage = source === target;
  const sources = sourceLanguages.includes(source as (typeof sourceLanguages)[number]) ? sourceLanguages : [source, ...sourceLanguages];

  return (
    <div className={styles.panel}>
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
          <Segmented<"translated" | "original">
            label="Qué se muestra"
            onChange={(value) => onVisibleChange(value === "translated")}
            options={[
              { label: "Traducción", value: "translated" },
              { label: "Original", value: "original" },
            ]}
            size="sm"
            value={visible ? "translated" : "original"}
          />
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
              Este navegador no trae traductor integrado: por ahora funciona en Chrome y Edge de
              escritorio. Aquí el libro se sigue leyendo en su idioma.
            </p>
          ) : phase.kind === "unavailable" ? (
            <p className={styles.notice} role="alert">
              El traductor del navegador no ofrece {languageName(source)} → {languageName(target)}.
              Prueba con otro par de idiomas.
            </p>
          ) : phase.kind === "error" ? (
            <p className={styles.notice} role="alert">
              {phase.message}
            </p>
          ) : null}
          <Button
            disabled={busy || sameLanguage || unitCount <= 0}
            onClick={() => onStart({ source, target })}
          >
            {phase.kind === "checking" ? "Comprobando el traductor…" : pair ? "Seguir traduciendo" : "Traducir este libro"}
          </Button>
          <p className={styles.hint}>
            {sameLanguage
              ? "El libro ya está en ese idioma."
              : `Se traduce en este dispositivo con el traductor del navegador: el texto no sale del equipo. Primero la ${unitNoun.singular} que lees y, mientras tanto, ${aheadLabel(ahead, unitNoun)}.`}
          </p>
        </>
      )}

      <p className={styles.rights}>
        Traducción automática, hecha en tu dispositivo para tu lectura: puede tener errores y se
        guarda solo aquí.
      </p>
    </div>
  );
}

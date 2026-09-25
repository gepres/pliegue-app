"use client";

import Link from "next/link";

import {
  effectiveScopeFor,
  readingProfiles,
  stepReaderScale,
  type LineHeight,
  type ReaderFont,
  type ReadingPreferences,
  type ReadingProfile,
  type Theme,
} from "../../preferences/preferences";
import {
  setPreference,
  setReadingProfile,
  usePreferences,
} from "../../preferences/preference-store";
import type { ReaderMeasure } from "../../preferences/reader-view";
import { setReaderMeasure, useReaderView } from "../../preferences/reader-view-store";
import { Segmented } from "../app-ui/controls";
import { Icon } from "../app-ui/icons";
import styles from "./reader.module.css";

const profileLabels: Record<ReadingProfile, string> = {
  accessible: "Accesible",
  balanced: "Equilibrado",
  focus: "Concentración",
};

/**
 * El menú «Aa» del lector: todo lo que cambia cómo se ve el texto, a un toque y sin salir
 * del documento. Cada cambio se aplica al momento —la página de detrás es la vista
 * previa— y se guarda en el nivel que ya mandaba sobre esa clave (ver `effectiveScopeFor`).
 */
export function ReaderAppearance({ onDone }: { onDone?: () => void }) {
  const { resolved, state } = usePreferences();
  const { measure } = useReaderView();

  function update<Key extends keyof ReadingPreferences>(key: Key, value: ReadingPreferences[Key]) {
    setPreference(effectiveScopeFor(state, key), key, value);
  }

  return (
    <div className={styles.appearance}>
      <div className={styles.appearanceRow}>
        <span className={styles.appearanceLabel}>Tema</span>
        <Segmented<Theme>
          label="Tema"
          onChange={(value) => update("theme", value)}
          options={[
            { icon: "sun", label: "Claro", value: "light" },
            { icon: "moon", label: "Oscuro", value: "dark" },
            { icon: "monitor", label: "Auto", value: "system" },
          ]}
          value={resolved.theme}
        />
      </div>

      <div className={styles.appearanceRow}>
        <span className={styles.appearanceLabel}>Letra</span>
        <Segmented<ReaderFont>
          label="Tipografía"
          onChange={(value) => update("readerFont", value)}
          options={[
            {
              label: "Serif editorial",
              preview: <span className={styles.fontSampleSerif}>Aa Serif</span>,
              value: "serif",
            },
            {
              label: "Sans serif accesible",
              preview: <span className={styles.fontSampleSans}>Aa Sans</span>,
              value: "sans",
            },
          ]}
          value={resolved.readerFont}
        />
      </div>

      <div className={styles.appearanceRow}>
        <span className={styles.appearanceLabel}>Tamaño</span>
        <div className={styles.stepper} role="group" aria-label="Tamaño del texto">
          <button
            aria-label="Reducir el texto"
            disabled={stepReaderScale(resolved.readerScale, -1) === resolved.readerScale}
            onClick={() => update("readerScale", stepReaderScale(resolved.readerScale, -1))}
            type="button"
          >
            <span className={styles.stepperSmallA}>A</span>
          </button>
          <output aria-live="polite">{resolved.readerScale} %</output>
          <button
            aria-label="Ampliar el texto"
            disabled={stepReaderScale(resolved.readerScale, 1) === resolved.readerScale}
            onClick={() => update("readerScale", stepReaderScale(resolved.readerScale, 1))}
            type="button"
          >
            <span className={styles.stepperLargeA}>A</span>
          </button>
        </div>
      </div>

      <div className={styles.appearanceRow}>
        <span className={styles.appearanceLabel}>Interlineado</span>
        <Segmented<LineHeight>
          label="Interlineado"
          onChange={(value) => update("lineHeight", value)}
          options={[
            { label: "Compacto", value: "compact" },
            { label: "Cómodo", value: "comfortable" },
            { label: "Amplio", value: "relaxed" },
          ]}
          size="sm"
          value={resolved.lineHeight}
        />
      </div>

      <div className={styles.appearanceRow}>
        <span className={styles.appearanceLabel}>Ancho de línea</span>
        <Segmented<ReaderMeasure>
          label="Ancho de línea"
          onChange={setReaderMeasure}
          options={[
            { label: "Estrecho", value: "narrow" },
            { label: "Normal", value: "normal" },
            { label: "Ancho", value: "wide" },
          ]}
          size="sm"
          value={measure}
        />
      </div>

      <div className={styles.appearanceProfiles}>
        <span className={styles.appearanceLabel}>Perfiles rápidos</span>
        <div>
          {readingProfiles.map((profile) => (
            <button
              aria-pressed={resolved.profile === profile}
              className={styles.profileChip}
              key={profile}
              onClick={() => setReadingProfile(effectiveScopeFor(state, "profile"), profile)}
              type="button"
            >
              {resolved.profile === profile ? <Icon name="check" size={14} /> : null}
              {profileLabels[profile]}
            </button>
          ))}
        </div>
      </div>

      <Link className={styles.appearanceMore} href="/app/ajustes#lectura" onClick={() => onDone?.()}>
        Preferencias por nivel
        <Icon name="chevronRight" size={16} />
      </Link>
    </div>
  );
}

"use client";

import { useState } from "react";

import styles from "./translation-modes.module.css";

/**
 * El capítulo destacado de la traducción en la portada (02.9d): una página de ejemplo traducida
 * de las dos maneras del lector. «Sobre la página» deja la figura y la maquetación en su sitio y
 * cambia el texto; «En paralelo» pone el original y la traducción uno al lado del otro.
 */

type Mode = "overlay" | "parallel";

const modes: { label: string; value: Mode }[] = [
  { label: "Sobre la página", value: "overlay" },
  { label: "En paralelo", value: "parallel" },
];

const original = "Her map had no names, only arrows. Each one pointed to a bend the river had already left behind.";
const translated = "Su mapa no tenía nombres, solo flechas. Cada una señalaba una curva que el río ya había dejado atrás.";

/**
 * La lámina del libro: el curso del río en 1902 (a trazos) y en 1958, un poco más al oeste, con
 * flechas hacia las curvas que dejó atrás. Lo mismo que cuenta el texto de la página.
 */
function Plate({ caption }: { caption: string }) {
  return (
    <figure className={styles.plate}>
      <svg aria-hidden="true" className={styles.map} viewBox="0 0 320 130">
        <defs>
          <marker id="flecha-rio" markerHeight="7" markerWidth="7" orient="auto-start-reverse" refX="6" refY="3.5">
            <path d="M0 0 L7 3.5 L0 7 z" fill="currentColor" />
          </marker>
        </defs>
        <path className={styles.oldCourse} d="M0 62 C 40 18, 78 112, 122 64 S 202 16, 244 62 S 296 104, 320 78" />
        <path className={styles.newCourse} d="M0 74 C 32 32, 62 122, 104 76 S 182 28, 222 76 S 286 118, 320 92" />
        <g className={styles.arrows}>
          <path d="M70 20 L76 44" markerEnd="url(#flecha-rio)" />
          <path d="M168 110 L163 88" markerEnd="url(#flecha-rio)" />
          <path d="M276 30 L270 54" markerEnd="url(#flecha-rio)" />
        </g>
        <text className={styles.year} x="10" y="22">
          1902
        </text>
        <text className={styles.yearNew} x="10" y="122">
          1958
        </text>
      </svg>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

export function TranslationModes() {
  const [mode, setMode] = useState<Mode>("overlay");

  return (
    <figure aria-label="Ejemplo: una página traducida sobre la página o en paralelo" className={styles.sample}>
      <div className={styles.page} data-mode={mode}>
        {mode === "overlay" ? (
          <div className={styles.single} lang="es">
            <p className={styles.folio}>The Slow Library · 43 · traducida</p>
            <Plate caption="Fig. 3 · El río, de 1902 a 1958" />
            <p className={styles.text}>{translated}</p>
          </div>
        ) : (
          <div className={styles.columns}>
            <div className={styles.shared}>
              <Plate caption="Fig. 3 · The river, 1902–1958 · El río, de 1902 a 1958" />
            </div>
            <div lang="en">
              <p className={styles.folio}>43 · original</p>
              <p className={styles.text}>{original}</p>
            </div>
            <div lang="es">
              <p className={styles.folio}>43 · español</p>
              <p className={styles.text}>{translated}</p>
            </div>
          </div>
        )}
      </div>
      <fieldset className={styles.modes}>
        <legend>Cómo traducir · ejemplo</legend>
        <div className={styles.track}>
          {modes.map((option) => (
            <label key={option.value}>
              <input checked={mode === option.value} name="modo-de-traduccion" onChange={() => setMode(option.value)} type="radio" value={option.value} />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </figure>
  );
}

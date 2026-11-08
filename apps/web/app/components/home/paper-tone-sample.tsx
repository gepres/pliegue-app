"use client";

import { useState } from "react";

import { defaultReadingFilter, toneLayersFor, type ReadingTone } from "../../preferences/reading-filter";
import styles from "./paper-tone-sample.module.css";

/**
 * La apertura de la Parte II de la portada (02.9d): una página del lector con el tono del papel
 * que se elija. Las capas son las mismas del lector (`toneLayersFor`), con su intensidad por
 * defecto, así que lo que se ve aquí es lo que se ve al leer.
 */

const tones: { label: string; value: ReadingTone }[] = [
  { label: "Sin tono", value: "none" },
  { label: "Sepia", value: "sepia" },
  { label: "Cálido", value: "warm" },
  { label: "Gris", value: "gray" },
];

export function PaperToneSample() {
  const [tone, setTone] = useState<ReadingTone>("sepia");
  const layers = toneLayersFor({ intensity: defaultReadingFilter.intensity, tone });

  return (
    <figure aria-label="Ejemplo: el tono del papel del lector" className={styles.sample}>
      <div className={styles.page}>
        <p className={styles.running}>Capítulo tres · 87</p>
        <p className={styles.text}>
          De noche, la página se vuelve más amable: el blanco se apaga, la tinta se queda negra y
          la vista aguanta un capítulo más. El tono se queda en tu equipo, para cada vez que vuelvas
          a abrir el libro.
        </p>
        {layers.map((layer, index) => (
          <span
            aria-hidden="true"
            className={styles.layer}
            key={`${tone}-${index}`}
            style={{ background: layer.background, mixBlendMode: layer.blend, opacity: layer.opacity }}
          />
        ))}
      </div>
      <fieldset className={styles.tones}>
        <legend>Tono del papel</legend>
        {tones.map((option) => (
          <label data-tone={option.value} key={option.value}>
            <input checked={tone === option.value} name="tono-del-papel" onChange={() => setTone(option.value)} type="radio" value={option.value} />
            <span>{option.label}</span>
          </label>
        ))}
      </fieldset>
    </figure>
  );
}

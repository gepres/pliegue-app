"use client";

import { useState } from "react";

import styles from "./postcard-sample.module.css";

/**
 * El capítulo destacado de las marcas en la portada (02.9d): una cita subrayada convertida en
 * postal, con los formatos para redes y los cuatro colores de resaltado del lector. La postal
 * conserva su alto y cambia de ancho, así que la página no salta al cambiar de formato.
 */

const formats = [
  { label: "1:1", ratio: "1 / 1", value: "square" },
  { label: "4:5", ratio: "4 / 5", value: "portrait" },
  { label: "9:16", ratio: "9 / 16", value: "story" },
] as const;

const colors = [
  { label: "Ámbar", value: "amber" },
  { label: "Verde", value: "green" },
  { label: "Azul", value: "blue" },
  { label: "Rosa", value: "rose" },
] as const;

type Format = (typeof formats)[number]["value"];
type Color = (typeof colors)[number]["value"];

export function PostcardSample() {
  const [format, setFormat] = useState<Format>("portrait");
  const [color, setColor] = useState<Color>("amber");
  const ratio = formats.find((option) => option.value === format)?.ratio ?? "4 / 5";

  return (
    <figure aria-label="Ejemplo: una cita subrayada convertida en postal" className={styles.sample}>
      <div className={styles.stage}>
        <div className={styles.card} data-color={color} style={{ aspectRatio: ratio }}>
          <p className={styles.quote}>
            <mark>Mi abuela lo llamaba una biblioteca lenta.</mark>
          </p>
          <p className={styles.credit}>The Slow Library · p. 42</p>
        </div>
      </div>
      <div className={styles.controls}>
        <fieldset className={styles.choices}>
          <legend>Formato</legend>
          {formats.map((option) => (
            <label key={option.value}>
              <input checked={format === option.value} name="formato-de-postal" onChange={() => setFormat(option.value)} type="radio" value={option.value} />
              <span>{option.label}</span>
            </label>
          ))}
        </fieldset>
        <fieldset className={styles.choices}>
          <legend>Resaltado</legend>
          {colors.map((option) => (
            <label data-color={option.value} key={option.value}>
              <input checked={color === option.value} name="color-de-resaltado" onChange={() => setColor(option.value)} type="radio" value={option.value} />
              <span className={styles.swatchLabel}>{option.label}</span>
            </label>
          ))}
        </fieldset>
      </div>
    </figure>
  );
}

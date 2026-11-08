"use client";

import { useState, type CSSProperties } from "react";

import styles from "./book-question.module.css";

/**
 * El pliego de la portada (02.9d): lo que Pliegue hace de verdad con un libro, en un ejemplo.
 * El original y su traducción enfrentados, cada frase iluminada a la vez en los dos idiomas; una
 * pregunta a lápiz en el margen y, debajo, la respuesta de Pliegue con su nota al pie, que
 * señala en el libro la frase citada (la llamada «1» es un botón). Todo es un ejemplo inventado:
 * la respuesta no la escribe ninguna IA en la portada.
 */

const original = [
  "The river kept its promises better than the maps.",
  "Every spring it moved a little to the west, as if it were reading something we could not see.",
  "My grandmother called it a slow library.",
];

const translated = [
  "El río cumplía sus promesas mejor que los mapas.",
  "Cada primavera se movía un poco hacia el oeste, como si leyera algo que nosotros no veíamos.",
  "Mi abuela lo llamaba una biblioteca lenta.",
];

/** La frase que cita la respuesta (la segunda de cada página). */
const citedPair = 1;

function Sentences({ lines }: { lines: string[] }) {
  return (
    <p>
      {lines.map((sentence, index) => (
        <span
          className={index === citedPair ? `${styles.sentence} ${styles.cited}` : styles.sentence}
          key={sentence}
          style={{ "--pair": index } as CSSProperties}
        >
          {sentence}{" "}
        </span>
      ))}
    </p>
  );
}

export function AskTheBook() {
  const [pointing, setPointing] = useState(false);
  const [round, setRound] = useState(0);

  return (
    <figure aria-label="Ejemplo: preguntarle a un libro y recibir la respuesta con su cita" className={styles.spread}>
      <div className={styles.stage}>
        {/* Las dos páginas repiten lo que dice la respuesta: para el lector de pantalla basta ella. */}
        <div aria-hidden="true" className={styles.book} data-pointing={pointing}>
          <div className={styles.leaf} lang="en">
            <span className={styles.folio}>The Slow Library · 42</span>
            <Sentences lines={original} />
          </div>
          <div className={styles.gutter} />
          <div className={`${styles.leaf} ${styles.leafTranslated}`} lang="es">
            <span className={styles.folio}>42 · español</span>
            <Sentences lines={translated} />
            <span className={styles.dogEar} />
          </div>
        </div>
        <p className={styles.question}>
          <span className={styles.visuallyHidden}>Pregunta al margen: </span>
          ¿Por qué la abuela lo llamaba «una biblioteca lenta»?
        </p>
      </div>

      <div aria-label="Respuesta de ejemplo" className={styles.answer} key={round} role="group">
        <p className={styles.answerHead}>
          <strong>Pliegue responde</strong>
          <span>Ejemplo · con la IA que elijas</span>
        </p>
        <p className={styles.answerText}>
          Porque cada primavera el río cambiaba de curso,{" "}
          <span className={styles.quote}>«como si leyera algo que nosotros no veíamos»</span>
          <button
            aria-label="Nota 1: señalar en el libro la frase citada"
            aria-pressed={pointing}
            className={styles.noteCall}
            onClick={() => setPointing((value) => !value)}
            type="button"
          >
            1
          </button>
          : para ella, un lector sin prisa.
        </p>
        <p className={styles.footnote}>
          <span>1 · The Slow Library, p. 42 · cita comprobada en el libro</span>
          <button
            className={styles.again}
            onClick={() => {
              setPointing(false);
              setRound((value) => value + 1);
            }}
            type="button"
          >
            Preguntar otra vez
          </button>
        </p>
      </div>
    </figure>
  );
}

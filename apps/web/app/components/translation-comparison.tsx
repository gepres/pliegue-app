"use client";

import {
  costPerBook,
  formatBookCost,
  translationOptions,
  type TranslationProviderChoice,
} from "../ai/translation-options";
import styles from "./translation-comparison.module.css";

/**
 * ¿Con qué traducir? Las seis opciones lado a lado: lo que cuesta un libro —en barras, con la
 * cifra escrita—, si hay versión gratuita, la calidad que cabe esperar, la velocidad y adónde va
 * el texto. Las cifras salen de `translation-options.ts`, calculadas con los precios de cada uno.
 */
export function TranslationComparison({
  onChoose,
  selected,
}: {
  onChoose: (choice: TranslationProviderChoice) => void;
  selected: TranslationProviderChoice;
}) {
  const rows = translationOptions.map((option) => ({ ...option, cost: costPerBook(option.pricing) }));
  const maxCost = Math.max(...rows.map((row) => row.cost));
  const cheapestPaid = rows
    .filter((row) => row.cost > 0 && row.quality === "Muy buena")
    .sort((left, right) => left.cost - right.cost)[0];

  return (
    <section aria-labelledby="translation-comparison-title" className={styles.comparison}>
      <header className={styles.head}>
        <h4 id="translation-comparison-title">¿Con cuál traducir?</h4>
        <p>Coste estimado de un libro de unas 90.000 palabras (550.000 caracteres).</p>
      </header>

      <ul className={styles.advice}>
        <li>
          <strong>Para empezar:</strong> Chrome o Edge. Gratis, privado y al instante.
        </li>
        {cheapestPaid ? (
          <li>
            <strong>Más calidad por poco:</strong> {cheapestPaid.label} ({cheapestPaid.model}),{" "}
            {formatBookCost(cheapestPaid.cost)} por libro.
          </li>
        ) : null}
        <li>
          <strong>Gratis fuera de Chrome:</strong> Gemini, con límites, o Azure, unos tres libros y
          medio al mes.
        </li>
        <li>
          <strong>Que el texto no salga de tu equipo:</strong> Chrome u Ollama.
        </li>
      </ul>

      <table className={styles.table}>
        <caption className={styles.visuallyHidden}>Comparativa de traductores para un libro</caption>
        <thead>
          <tr>
            <th scope="col">Traductor</th>
            <th scope="col">Coste por libro</th>
            <th scope="col">Gratis</th>
            <th scope="col">Calidad</th>
            <th scope="col">Velocidad</th>
            <th scope="col">Tu texto</th>
            <th scope="col">
              <span className={styles.visuallyHidden}>Elegir</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const chosen = row.id === selected;
            return (
              <tr data-chosen={chosen ? "true" : undefined} key={row.id}>
                <th scope="row">
                  <span className={styles.name}>{row.label}</span>
                  {row.model ? <span className={styles.model}>{row.model}</span> : null}
                </th>
                <td className={styles.costCell} data-label="Coste por libro">
                  <span className={styles.cost}>{formatBookCost(row.cost)}</span>
                  <span aria-hidden="true" className={styles.track}>
                    {row.cost > 0 ? (
                      <span className={styles.bar} style={{ width: `${Math.max(2, (row.cost / maxCost) * 100)}%` }} />
                    ) : null}
                  </span>
                </td>
                <td data-label="Gratis">{row.free}</td>
                <td data-label="Calidad">
                  <span className={styles.quality} data-level={row.quality}>
                    {row.quality}
                  </span>
                </td>
                <td data-label="Velocidad">{row.speed}</td>
                <td data-label="Tu texto">{row.privacy}</td>
                <td className={styles.action}>
                  <button
                    aria-pressed={chosen}
                    className={styles.choose}
                    disabled={chosen}
                    onClick={() => onChoose(row.id)}
                    type="button"
                  >
                    {chosen ? "Elegido" : "Usar"}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className={styles.sources}>
        Precios de cada proveedor a 29 de septiembre de 2026; los de Azure, por caracteres y el resto,
        por tokens. Calidad: en WMT25, la evaluación humana de referencia, los LLM grandes
        encabezan —Gemini 2.5 Pro quedó en el grupo ganador de 14 de 15 pares de idiomas, y las
        traducciones humanas de referencia solo en 6—; los modelos baratos de cada familia no se
        evaluaron y su calidad es una estimación. Las velocidades de Chrome y Ollama están medidas en
        Pliegue; las demás son orientativas.
      </p>
    </section>
  );
}

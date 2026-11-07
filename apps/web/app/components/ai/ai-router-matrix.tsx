"use client";

import Link from "next/link";

import { Card } from "@pliegue/ui";

import { useAiSettings } from "../../ai/ai-settings-store";
import { flowSends, flowTitles, outcomeLabel, routerMatrix } from "../../ai/flow-router";
import { sensitivityLevels, sensitivityNames } from "../../library/sensitivity";
import styles from "./ai-router-matrix.module.css";

/**
 * Ajustes → IA: quién hace cada tarea (04.3). Una fila por flujo que puede sacar el texto de un
 * libro del equipo y, en cada nivel de sensibilidad, qué pasa con ese libro. Es lo guardado: lo
 * que se aplica de verdad al catalogar, traducir, buscar y preguntar.
 */
export function AiRouterMatrix() {
  const settings = useAiSettings();
  const rows = routerMatrix(settings);
  return (
    <Card aria-labelledby="ai-router-title" as="section" className={styles.panel}>
      <div className={styles.intro}>
        <h2 id="ai-router-title">Quién hace cada tarea</h2>
        <p>
          Con lo que tienes guardado: qué proveedor hace cada tarea, dónde, y qué pasa con un libro según su
          sensibilidad. La sensibilidad se marca en <Link href="/app/ajustes#fuentes">Ajustes → Fuentes</Link> o en el
          menú de cada libro; sin marcar, es interno.
        </p>
      </div>

      <table className={styles.matrix}>
        <thead>
          <tr>
            <th scope="col">Tarea</th>
            <th scope="col">Quién y dónde</th>
            {sensitivityLevels.map((level) => (
              <th key={level} scope="col">
                {sensitivityNames[level]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr data-flow={row.flow} key={row.flow}>
              <th scope="row">
                {flowTitles[row.flow]}
                <small>Envía {flowSends[row.flow]}</small>
              </th>
              <td className={styles.engine} data-place={row.place ?? "none"}>
                <strong>{row.engineName}</strong>
                {row.model ? <span className={styles.model}>{row.model}</span> : null}
                <small>{row.where}</small>
              </td>
              {sensitivityLevels.map((level) => (
                <td data-outcome={row.outcomes[level]} key={level}>
                  <span className={styles.level}>{sensitivityNames[level]}</span>
                  <span className={styles.outcome}>{outcomeLabel(row.flow, row.outcomes[level])}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <ul className={styles.rules}>
        <li>
          <strong>Pregunta una vez:</strong> antes de que un libro personal salga del equipo en una tarea, se pide
          permiso para ese libro y esa tarea, y se recuerda.
        </li>
        <li>
          <strong>Sin respaldo automático:</strong> si el proveedor de una tarea falla, Pliegue no prueba con otro por
          su cuenta. Te lo dice y eliges tú; así ningún libro acaba en un proveedor que no elegiste.
        </li>
        <li>
          <strong>Por dónde pasa:</strong> OpenAI, Claude, Gemini, DeepL y Azure reciben el texto a través del servidor
          de Pliegue, que no lo guarda; Ollama y LibreTranslate, directamente desde tu navegador. La región en la que
          procesa cada proveedor la fija él o tu cuenta con él; Pliegue no la cambia (Azure usa la de tu recurso).
        </li>
        <li>
          <strong>Gasto y registro:</strong> todo lo que sale cuenta para el presupuesto y queda, sin el texto, en el
          registro de la IA de esta página.
        </li>
      </ul>
    </Card>
  );
}

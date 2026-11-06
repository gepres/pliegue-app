"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { Button } from "@pliegue/ui";

import type { LibraryDocument } from "../../library/documents";
import {
  defaultSensitivity,
  sensitivityHelp,
  sensitivityLevels,
  sensitivityNames,
  sourceKeyOf,
  type Sensitivity,
} from "../../library/sensitivity";
import { sensitivityMarks, setDocumentSensitivity } from "../../library/sensitivity-store";
import { Icon } from "../app-ui/icons";
import styles from "../app-ui/app-ui.module.css";
import own from "./sensitivity-picker.module.css";

/**
 * Elegir la sensibilidad de un libro (04.3), desde su menú. Un solo diálogo para toda la
 * Biblioteca, como el de confirmar: `pickSensitivity(libro)` lo abre.
 */

type Target = Pick<LibraryDocument, "id" | "reference" | "title">;

let open: Target | null = null;
let asked = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export function pickSensitivity(document: Target) {
  open = document;
  asked += 1;
  emit();
}

function close() {
  open = null;
  emit();
}

/** «Como su fuente» es la opción de no marcar el libro. */
type Choice = Sensitivity | "source";

export function SensitivityPickerHost() {
  const current = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => open,
    () => null,
  );
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (current && !dialog.open) dialog.showModal();
    if (!current && dialog.open) dialog.close();
  }, [current]);

  return (
    <dialog
      aria-labelledby="sensitivity-title"
      className={styles.confirm}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      ref={dialogRef}
    >
      {current ? <Picker document={current} key={`${current.id}-${asked}`} /> : null}
    </dialog>
  );
}

function Picker({ document }: { document: Target }) {
  const marks = sensitivityMarks();
  const sourceLevel = marks.sources[sourceKeyOf(document)] ?? defaultSensitivity;
  const [choice, setChoice] = useState<Choice>(marks.documents[document.id] ?? "source");

  return (
    <form
      className={styles.confirmBody}
      onSubmit={(event) => {
        event.preventDefault();
        setDocumentSensitivity(document.id, choice === "source" ? null : choice);
        close();
      }}
    >
      <header className={styles.confirmHead}>
        <span aria-hidden="true" className={styles.confirmIcon}>
          <Icon name="info" size={20} />
        </span>
        <h2 id="sensitivity-title">Sensibilidad de «{document.title}»</h2>
      </header>
      <fieldset className={own.options}>
        <legend className={own.legend}>Qué puede hacer la IA con este libro</legend>
        {(["source", ...sensitivityLevels] as const).map((option) => {
          const level = option === "source" ? sourceLevel : option;
          return (
            <label className={own.option} key={option}>
              <input checked={choice === option} name="sensitivity" onChange={() => setChoice(option)} type="radio" value={option} />
              <span>
                <strong>{option === "source" ? `Como su fuente (${sensitivityNames[sourceLevel].toLowerCase()})` : sensitivityNames[option]}</strong>
                <small>{sensitivityHelp[level]}</small>
              </span>
            </label>
          );
        })}
      </fieldset>
      <p className={styles.confirmNote}>Se guarda en este equipo. La de cada fuente se cambia en Ajustes → Fuentes.</p>
      <div className={styles.confirmActions}>
        <Button onClick={close} type="button" variant="secondary">
          Cancelar
        </Button>
        <Button type="submit">Guardar</Button>
      </div>
    </form>
  );
}

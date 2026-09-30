"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

import { Button } from "@pliegue/ui";

import { useStableId } from "./controls";
import { Icon, type IconName } from "./icons";
import styles from "./app-ui.module.css";

/**
 * Confirmación con el aspecto de la app en lugar de `window.confirm`.
 *
 * El diálogo del navegador no se podía leer bien —un párrafo gris con saltos de línea—, no
 * seguía el tema ni el idioma de sus botones («Aceptar») y detenía toda la página. Este se pide
 * igual, con una promesa, así que cambiarlo no reescribe la lógica de quien pregunta:
 *
 *   if (!(await confirmAction({ title: "¿Desvincular…?", confirmLabel: "Desvincular" }))) return;
 *
 * Lo pinta un único `ConfirmDialogHost`, montado en el shell de la app.
 */
export interface ConfirmOptions {
  cancelLabel?: string;
  confirmLabel: string;
  /** Qué pasa, en una frase. */
  description?: string;
  /** Lo que se pierde, uno por renglón: se lee mejor que una frase con cuatro comas. */
  details?: readonly string[];
  icon?: IconName;
  /** Una salida o un matiz, en letra menor: «Si solo quieres recuperar el acceso…». */
  note?: string;
  title: string;
  tone?: "danger" | "default";
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (confirmed: boolean) => void;
}

let pending: PendingConfirm | null = null;
let hosts = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function settle(confirmed: boolean) {
  const current = pending;
  pending = null;
  emit();
  current?.resolve(confirmed);
}

export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  if (!hosts) {
    // Sin anfitrión no hay a quién preguntar, y una acción destructiva sin confirmar es peor
    // que no hacerla.
    console.warn("confirmAction sin ConfirmDialogHost montado: se cancela.");
    return Promise.resolve(false);
  }
  // Una pregunta nueva sustituye a la que estuviera abierta, que se da por cancelada.
  pending?.resolve(false);
  return new Promise((resolve) => {
    pending = { ...options, resolve };
    emit();
  });
}

export function ConfirmDialogHost() {
  const current = useSyncExternalStore(
    subscribe,
    () => pending,
    () => null,
  );
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useStableId("confirm-title");
  const descriptionId = useStableId("confirm-description");

  useEffect(() => {
    hosts += 1;
    return () => {
      hosts -= 1;
      // Si el anfitrión desaparece con una pregunta abierta, la respuesta es «no».
      if (!hosts) settle(false);
    };
  }, []);

  // `showModal` y no un `div`: pone el diálogo en la capa superior, deja inerte el resto de
  // la página y devuelve el foco a quien lo abrió al cerrarse.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (current && !dialog.open) dialog.showModal();
    if (!current && dialog.open) dialog.close();
  }, [current]);

  const danger = current?.tone === "danger";
  const icon = current?.icon ?? (danger ? "trash" : "info");

  return (
    <dialog
      aria-describedby={current?.description ? descriptionId : undefined}
      aria-labelledby={titleId}
      className={styles.confirm}
      data-tone={danger ? "danger" : "default"}
      // Escape: el navegador cerraría el diálogo por su cuenta y la promesa quedaría colgada.
      onCancel={(event) => {
        event.preventDefault();
        settle(false);
      }}
      // Un clic en el velo cancela. El contenido ocupa todo el diálogo, así que solo el velo
      // tiene como destino el propio `<dialog>`.
      onClick={(event) => {
        if (event.target === event.currentTarget) settle(false);
      }}
      ref={dialogRef}
      role="alertdialog"
    >
      {current ? (
        <div className={styles.confirmBody}>
          <header className={styles.confirmHead}>
            <span aria-hidden="true" className={styles.confirmIcon}>
              <Icon name={icon} size={20} />
            </span>
            <h2 id={titleId}>{current.title}</h2>
          </header>
          {current.description ? <p id={descriptionId}>{current.description}</p> : null}
          {current.details?.length ? (
            <ul className={styles.confirmDetails}>
              {current.details.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          ) : null}
          {current.note ? <p className={styles.confirmNote}>{current.note}</p> : null}
          <div className={styles.confirmActions}>
            {/* El foco empieza en «Cancelar»: un Intro de más no debe borrar nada. */}
            <Button autoFocus onClick={() => settle(false)} variant="secondary">
              {current.cancelLabel ?? "Cancelar"}
            </Button>
            <Button
              className={danger ? styles.confirmDanger : undefined}
              onClick={() => settle(true)}
              variant={danger ? "danger" : "primary"}
            >
              {current.confirmLabel}
            </Button>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}

"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useSyncExternalStore } from "react";

import { Button, cx } from "@pliegue/ui";

import { guideMuted, setGuideMuted, useGuideMuted } from "../../guide/guide-store";
import { useStableId } from "./controls";
import { Icon, type IconName } from "./icons";
import styles from "./app-ui.module.css";

/**
 * «¿Y ahora qué?» tras una acción importante. Sigue la regla de interrumpir solo cuando hay un
 * motivo: aparece justo después de algo que la persona hizo —nunca al entrar en una página—,
 * dice qué se consiguió y ofrece el paso siguiente más probable, con otras salidas y un
 * «Ahora no». Quien conoce el camino puede apagar estas sugerencias desde el propio modal.
 */
export interface NextStepAction {
  /** Por qué no se puede todavía, en lugar de esconderla: así se ve qué falta. */
  blockedReason?: string;
  description?: string;
  href?: string;
  icon: IconName;
  label: string;
  onSelect?: () => void;
  primary?: boolean;
}

export interface NextStepOptions {
  actions: NextStepAction[];
  description?: string;
  icon?: IconName;
  title: string;
}

let current: NextStepOptions | null = null;
let hosts = 0;
const listeners = new Set<() => void>();

function emit(next: NextStepOptions | null) {
  current = next;
  for (const listener of listeners) listener();
}

/** Sugiere el paso siguiente, salvo que la persona haya apagado las sugerencias. */
export function suggestNextStep(options: NextStepOptions) {
  if (!hosts || guideMuted()) return;
  emit(options);
}

export function NextStepHost() {
  const step = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => null,
  );
  const muted = useGuideMuted();
  const router = useRouter();
  const pathname = usePathname();
  const dialogRef = useRef<HTMLDialogElement>(null);
  // «Ver la Biblioteca» estando en la Biblioteca no lleva a ninguna parte: para eso está «Ahora no».
  const actions = step?.actions.filter((action) => action.href !== pathname) ?? [];
  const titleId = useStableId("next-step-title");

  useEffect(() => {
    hosts += 1;
    return () => {
      hosts -= 1;
    };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (step && !dialog.open) dialog.showModal();
    if (!step && dialog.open) dialog.close();
  }, [step]);

  function choose(action: NextStepAction) {
    emit(null);
    action.onSelect?.();
    if (action.href) router.push(action.href);
  }

  return (
    <dialog
      aria-labelledby={titleId}
      className={cx(styles.confirm, styles.nextStep)}
      onCancel={(event) => {
        event.preventDefault();
        emit(null);
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) emit(null);
      }}
      ref={dialogRef}
    >
      {step ? (
        <div className={styles.confirmBody}>
          <header className={styles.confirmHead}>
            <span aria-hidden="true" className={styles.confirmIcon}>
              <Icon name={step.icon ?? "check"} size={20} />
            </span>
            <h2 id={titleId}>{step.title}</h2>
          </header>
          {step.description ? <p>{step.description}</p> : null}

          <p className={styles.nextStepLead}>Siguiente paso</p>
          <ul className={styles.nextStepActions}>
            {actions.map((action) => (
              <li key={action.label}>
                <button
                  className={styles.nextStepAction}
                  data-primary={action.primary ? "" : undefined}
                  disabled={Boolean(action.blockedReason)}
                  // El primero disponible recibe el foco: Intro sigue el camino recomendado.
                  autoFocus={action.primary && !action.blockedReason}
                  onClick={() => choose(action)}
                  type="button"
                >
                  <span aria-hidden="true" className={styles.nextStepActionIcon}>
                    <Icon name={action.icon} size={18} />
                  </span>
                  <span className={styles.nextStepActionText}>
                    <strong>{action.label}</strong>
                    {action.blockedReason || action.description ? (
                      <small>{action.blockedReason ?? action.description}</small>
                    ) : null}
                  </span>
                  <Icon name="chevronRight" size={16} />
                </button>
              </li>
            ))}
          </ul>

          <div className={styles.nextStepFooter}>
            <label className={styles.nextStepMute}>
              <input checked={muted} onChange={(event) => setGuideMuted(event.target.checked)} type="checkbox" />
              No volver a sugerir pasos
            </label>
            <Button onClick={() => emit(null)} variant="quiet">
              Ahora no
            </Button>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}

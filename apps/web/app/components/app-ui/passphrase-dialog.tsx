"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";

import { Button, Field, Input } from "@pliegue/ui";

import { minPassphraseLength, passphraseIssue } from "../../ai/key-vault-crypto";
import { useStableId } from "./controls";
import { Icon } from "./icons";
import styles from "./app-ui.module.css";

/**
 * La frase de la bóveda de claves (02.5): crearla la primera vez o escribirla en otro equipo.
 * Como `confirmAction`, se pide con una promesa y la contesta un anfitrión montado en el shell.
 * `verify` comprueba la frase sin cerrar el diálogo: si devuelve un mensaje, se enseña y se
 * puede volver a probar. La frase no se guarda en ningún sitio: va a `verify` y se olvida.
 */

export interface PassphraseRequest {
  mode: "create" | "unlock";
  /** Devuelve un mensaje si la frase no sirve, o null si ya está. */
  verify: (passphrase: string) => Promise<string | null>;
}

interface Pending extends PassphraseRequest {
  id: number;
  resolve: (done: boolean) => void;
}

let pending: Pending | null = null;
let counter = 0;
const listeners = new Set<() => void>();

function emit(next: Pending | null) {
  pending = next;
  for (const listener of listeners) listener();
}

/** Abre el diálogo; resuelve `true` cuando `verify` dio por buena la frase, `false` si se cancela. */
export function askPassphrase(request: PassphraseRequest): Promise<boolean> {
  pending?.resolve(false);
  return new Promise((resolve) => emit({ ...request, id: (counter += 1), resolve }));
}

function settle(done: boolean) {
  const current = pending;
  emit(null);
  current?.resolve(done);
}

export function PassphraseDialogHost() {
  const current = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => pending,
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
      aria-labelledby="passphrase-title"
      className={styles.confirm}
      data-tone="default"
      onCancel={(event) => {
        event.preventDefault();
        settle(false);
      }}
      ref={dialogRef}
    >
      {current ? <PassphraseForm key={current.id} request={current} /> : null}
    </dialog>
  );
}

function PassphraseForm({ request }: { request: Pending }) {
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const create = request.mode === "create";
  const passId = useStableId("passphrase");
  const confirmId = useStableId("passphrase-confirm");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const issue = create ? passphraseIssue(passphrase, confirmation) : passphrase ? null : "Escribe tu frase.";
    if (issue) {
      setProblem(issue);
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const failed = await request.verify(passphrase);
      if (failed) setProblem(failed);
      else settle(true);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "No se pudo comprobar la frase.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.confirmBody} onSubmit={(event) => void submit(event)}>
      <header className={styles.confirmHead}>
        <span aria-hidden="true" className={styles.confirmIcon}>
          <Icon name="cloud" size={20} />
        </span>
        <h2 id="passphrase-title">{create ? "Crea una frase para tus claves" : "Escribe tu frase"}</h2>
      </header>
      <p>
        {create
          ? "Con ella se cifran tus claves en este navegador antes de guardarlas en tu cuenta. Ni Pliegue ni Supabase pueden leerlas. La pedirá una vez en cada equipo."
          : "Tus claves están en tu cuenta, cifradas con tu frase. Escríbela para usarlas en este equipo; no se vuelve a pedir hasta que cierres sesión."}
      </p>
      <Field label={create ? "Frase nueva" : "Tu frase"} labelFor={passId}>
        <Input
          autoComplete={create ? "new-password" : "current-password"}
          autoFocus
          id={passId}
          minLength={create ? minPassphraseLength : undefined}
          onChange={(event) => setPassphrase(event.target.value)}
          type="password"
          value={passphrase}
        />
      </Field>
      {create ? (
        <Field label="Repítela" labelFor={confirmId}>
          <Input autoComplete="new-password" id={confirmId} onChange={(event) => setConfirmation(event.target.value)} type="password" value={confirmation} />
        </Field>
      ) : null}
      {problem ? (
        <p className={styles.confirmProblem} role="alert">
          {problem}
        </p>
      ) : null}
      <p className={styles.confirmNote}>
        {create
          ? `Al menos ${minPassphraseLength} caracteres; mejor varias palabras. Si la olvidas no se puede recuperar: vuelves a pegar tus claves.`
          : "¿La olvidaste? Cancela y, en Ajustes → IA, borra las claves de la cuenta para empezar de nuevo."}
      </p>
      <div className={styles.confirmActions}>
        <Button disabled={busy} onClick={() => settle(false)} type="button" variant="secondary">
          Cancelar
        </Button>
        <Button disabled={busy} type="submit">
          {busy ? "Comprobando…" : create ? "Crear y guardar" : "Abrir mis claves"}
        </Button>
      </div>
    </form>
  );
}

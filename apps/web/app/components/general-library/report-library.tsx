"use client";

import { useId, useRef, useState, type FormEvent } from "react";

import { Button, Field, Select } from "@pliegue/ui";

import { reportReasons, type ReportReason } from "../../library-access/report-reasons";
import { IconButton } from "../app-ui/controls";
import { Icon } from "../app-ui/icons";
import dialogStyles from "../app-ui/app-ui.module.css";
import styles from "./general-library.module.css";

/**
 * Denunciar una biblioteca compartida o, desde el lector, uno de sus libros. Le llega al
 * administrador de Pliegue; el dueño de la biblioteca no la ve ni sabe quién la mandó.
 */
export function ReportLibraryButton({ fileId = null, library }: { fileId?: string | null; library: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [reason, setReason] = useState<ReportReason>("derechos");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const subject = fileId ? "este libro" : "esta biblioteca";

  function open() {
    setSent(false);
    setError(null);
    dialogRef.current?.showModal();
  }

  function close() {
    dialogRef.current?.close();
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/biblioteca/denuncia", {
        body: JSON.stringify({ details, ...(fileId ? { fileId } : {}), library, reason }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(body.error ?? "No fue posible enviar la denuncia.");
        return;
      }
      setSent(true);
      setDetails("");
    } catch {
      setError("No hay conexión con Pliegue. Revisa tu internet y vuelve a intentarlo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {fileId ? (
        <IconButton icon="flag" label="Denunciar este libro" onClick={open} />
      ) : (
        <Button onClick={open} size="sm" variant="quiet">
          <Icon name="flag" size={16} />
          Denunciar
        </Button>
      )}
      <dialog
        aria-labelledby={titleId}
        className={dialogStyles.confirm}
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
        ref={dialogRef}
      >
        <form className={dialogStyles.confirmBody} onSubmit={(event) => void send(event)}>
          <header className={dialogStyles.confirmHead}>
            <span aria-hidden="true" className={dialogStyles.confirmIcon}>
              <Icon name="flag" size={20} />
            </span>
            <h2 id={titleId}>Denunciar {subject}</h2>
          </header>
          {sent ? (
            <p role="status">Gracias. La denuncia llegó a Pliegue, que la revisará. Quien comparte la biblioteca no sabrá que fuiste tú.</p>
          ) : (
            <>
              <p>Llega a quien administra Pliegue, no a quien comparte la biblioteca.</p>
              <Field label="Motivo" labelFor={`${titleId}-reason`}>
                <Select id={`${titleId}-reason`} onChange={(event) => setReason(event.target.value as ReportReason)} value={reason}>
                  {Object.entries(reportReasons).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field description="Opcional. Hasta 1.000 caracteres." label="Qué pasa" labelFor={`${titleId}-details`}>
                <textarea
                  className={styles.reportText}
                  id={`${titleId}-details`}
                  maxLength={1000}
                  onChange={(event) => setDetails(event.target.value)}
                  rows={4}
                  value={details}
                />
              </Field>
              {error ? (
                <p className={styles.error} role="alert">
                  {error}
                </p>
              ) : null}
            </>
          )}
          <div className={dialogStyles.confirmActions}>
            <Button onClick={close} type="button" variant="secondary">
              {sent ? "Cerrar" : "Cancelar"}
            </Button>
            {sent ? null : (
              <Button disabled={busy} type="submit">
                {busy ? "Enviando…" : "Enviar denuncia"}
              </Button>
            )}
          </div>
        </form>
      </dialog>
    </>
  );
}

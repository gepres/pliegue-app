"use client";

import { useState, useSyncExternalStore, type FormEvent } from "react";

import { Button, Card, Field, Input, Tag } from "@pliegue/ui";

import { normalizeAccessCode } from "../../library-access/access-session";
import { saveVisitorName, savedVisitorName, visitorDeviceId } from "../../library-access/visitor";
import { generalLibraryPath } from "../../library/general-library";
import styles from "./general-library.module.css";

/** Entrar en la biblioteca general: el código (de la dirección o escrito) y el nombre. */
const subscribeToNothing = () => () => undefined;

export function AccessForm({ initialCode = "" }: { initialCode?: string }) {
  const [code, setCode] = useState(initialCode.toUpperCase());
  // El nombre de la última vez solo existe en el navegador: en el servidor, vacío.
  const savedName = useSyncExternalStore(subscribeToNothing, savedVisitorName, () => "");
  const [typedName, setName] = useState<string | null>(null);
  const name = typedName ?? savedName;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!normalizeAccessCode(code)) {
      setError("El código tiene letras y números, sin espacios: por ejemplo OCT2026AREQUIPA.");
      return;
    }
    if (!name.trim()) {
      setError("Escribe tu nombre para entrar.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/biblioteca/acceso", {
        body: JSON.stringify({ code, deviceId: visitorDeviceId(), name }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(body.error ?? "No fue posible entrar. Inténtalo de nuevo.");
        return;
      }
      saveVisitorName(name.trim());
      // Carga completa: la página lee la sesión nueva en el servidor.
      window.location.assign(generalLibraryPath);
    } catch {
      setError("No hay conexión con Pliegue. Revisa tu internet y vuelve a intentarlo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card as="section" aria-labelledby="general-access-title" className={styles.accessCard}>
      <Tag>Biblioteca general</Tag>
      <h1 id="general-access-title">Entra con tu código</h1>
      <p className={styles.lead}>
        Una biblioteca abierta para leer, marcar y traducir. Lo que hagas con los libros se guarda solo en este navegador.
      </p>
      <form className={styles.accessForm} noValidate onSubmit={(event) => void submit(event)}>
        <Field label="Código de acceso" labelFor="general-code">
          <Input
            autoCapitalize="characters"
            autoComplete="off"
            autoFocus={!initialCode}
            id="general-code"
            maxLength={40}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder="OCT2026AREQUIPA"
            spellCheck={false}
            value={code}
          />
        </Field>
        <Field
          description="Para que quien te invitó sepa que entraste."
          label="Tu nombre"
          labelFor="general-name"
        >
          <Input
            autoComplete="name"
            autoFocus={Boolean(initialCode)}
            id="general-name"
            maxLength={60}
            onChange={(event) => setName(event.target.value)}
            value={name}
          />
        </Field>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        <Button disabled={busy} type="submit">
          {busy ? "Entrando…" : "Entrar"}
        </Button>
      </form>
    </Card>
  );
}

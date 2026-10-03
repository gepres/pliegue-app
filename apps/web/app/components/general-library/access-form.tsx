"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore, type FormEvent } from "react";

import { Button, Card, Field, Input, Tag } from "@pliegue/ui";

import { normalizeAccessCode, normalizeVisitorName } from "../../library-access/access-session";
import {
  legacyVisitorName,
  parseSavedEntries,
  saveEntry,
  savedEntriesSnapshot,
  visitorDeviceId,
} from "../../library-access/visitor";
import { generalLibraryPath } from "../../library/general-library";
import styles from "./general-library.module.css";

const subscribeToNothing = () => () => undefined;

function entryDate(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("es", { day: "numeric", month: "short" });
}

/**
 * Entrar en la biblioteca general. Quien ya entró desde este navegador vuelve con un clic, con
 * el mismo nombre y código: el servidor reconoce la vuelta y no gasta otro uso del código. Si
 * no, el código (de la dirección o escrito) y un nombre.
 */
export function AccessForm({ activeName = null, initialCode = "" }: { activeName?: string | null; initialCode?: string }) {
  // Lo guardado solo existe en el navegador: en el servidor, nada.
  const savedSerialized = useSyncExternalStore(subscribeToNothing, savedEntriesSnapshot, () => "");
  const legacyName = useSyncExternalStore(subscribeToNothing, legacyVisitorName, () => "");
  const saved = useMemo(() => parseSavedEntries(savedSerialized), [savedSerialized]);
  const urlCode = normalizeAccessCode(initialCode);
  // Con un código en la dirección, se ofrecen las entradas con ese código.
  const offers = urlCode ? saved.filter((entry) => entry.code === urlCode) : saved;

  const [otherEntry, setOtherEntry] = useState(false);
  const [code, setCode] = useState(initialCode.toUpperCase());
  const [typedName, setName] = useState<string | null>(null);
  const name = typedName ?? offers[0]?.name ?? saved[0]?.name ?? legacyName;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const showForm = otherEntry || !offers.length;

  async function enter(rawCode: string, rawName: string, key: string) {
    setError(null);
    const normalizedCode = normalizeAccessCode(rawCode);
    const normalizedName = normalizeVisitorName(rawName);
    if (!normalizedCode) {
      setError("El código tiene letras y números, sin espacios: por ejemplo OCT2026AREQUIPA.");
      return;
    }
    if (!normalizedName) {
      setError("Escribe tu nombre para entrar.");
      return;
    }
    setBusy(key);
    try {
      const response = await fetch("/api/biblioteca/acceso", {
        body: JSON.stringify({ code: normalizedCode, deviceId: visitorDeviceId(), name: normalizedName }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(body.error ?? "No fue posible entrar. Inténtalo de nuevo.");
        return;
      }
      saveEntry({ at: new Date().toISOString(), code: normalizedCode, name: normalizedName });
      // Carga completa: la página lee la sesión nueva en el servidor.
      window.location.assign(generalLibraryPath);
    } catch {
      setError("No hay conexión con Pliegue. Revisa tu internet y vuelve a intentarlo.");
    } finally {
      setBusy(null);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void enter(code, name, "form");
  }

  return (
    <Card as="section" aria-labelledby="general-access-title" className={styles.accessCard}>
      <Tag>Biblioteca general</Tag>
      <h1 id="general-access-title">{offers.length && !otherEntry ? "Hola de nuevo" : "Entra con tu código"}</h1>
      <p className={styles.lead}>
        {offers.length && !otherEntry
          ? "Ya entraste desde este navegador. Vuelve con un clic: no gasta otro uso del código."
          : "Una biblioteca abierta para leer, marcar y traducir. Lo que hagas con los libros se guarda solo en este navegador."}
      </p>

      {activeName ? (
        <p className={styles.notice} role="status">
          Ya estás dentro como {activeName} con otro código. Entra con este para que quede registrado, o{" "}
          <Link href={generalLibraryPath}>vuelve a la biblioteca</Link> sin cambiar de código.
        </p>
      ) : null}

      {offers.length && !otherEntry ? (
        <section aria-label="Entradas anteriores" className={styles.returning}>
          <ul>
            {offers.map((entry) => {
              const key = `${entry.code}|${entry.name}`;
              return (
                <li key={key}>
                  <button disabled={busy !== null} onClick={() => void enter(entry.code, entry.name, key)} type="button">
                    <span className={styles.returningText}>
                      <strong>Entrar como {entry.name}</strong>
                      <small>
                        {entry.code}
                        {entryDate(entry.at) ? ` · última vez el ${entryDate(entry.at)}` : ""}
                      </small>
                    </span>
                    <span aria-hidden="true" className={styles.returningArrow}>
                      {busy === key ? "…" : "→"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <button
            className={styles.textButton}
            onClick={() => {
              setOtherEntry(true);
              setError(null);
            }}
            type="button"
          >
            Entrar con otro nombre o código
          </button>
        </section>
      ) : null}

      {showForm ? (
        <form className={styles.accessForm} noValidate onSubmit={submit}>
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
          <Field description="Para que quien te invitó sepa que entraste." label="Tu nombre" labelFor="general-name">
            <Input
              autoComplete="name"
              autoFocus={Boolean(initialCode)}
              id="general-name"
              maxLength={60}
              onChange={(event) => setName(event.target.value)}
              value={name}
            />
          </Field>
          <Button disabled={busy !== null} type="submit">
            {busy === "form" ? "Entrando…" : "Entrar"}
          </Button>
          {offers.length ? (
            <button className={styles.textButton} onClick={() => setOtherEntry(false)} type="button">
              Volver a mis entradas anteriores
            </button>
          ) : null}
        </form>
      ) : null}

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </Card>
  );
}

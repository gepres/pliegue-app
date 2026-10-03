"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import { Button, Card, Field, Input, Switch, Tag } from "@pliegue/ui";

import {
  requestEmailCode,
  signInWithGoogle,
  signOut,
  useAccount,
  verifyEmailCode,
} from "../../cloud/account-store";
import {
  requestSync,
  setSyncChoices,
  useSyncChoices,
  useSyncStatus,
} from "../../cloud/sync/sync-controller";
import { useIsPliegueAdmin } from "../../cloud/admin-store";
import { describeChanges } from "../../cloud/sync/sync-activity";
import { confirmAction } from "../app-ui/confirm-dialog";
import { Icon } from "../app-ui/icons";
import styles from "./account-panel.module.css";
import { SyncDetails } from "./sync-details";

/** Lo que viaja con la cuenta, tal como se lo explica a quien decide activarla. */
const syncedItems = [
  "Favoritos y progreso de lectura",
  "Resaltados, notas y recortes",
  "Fichas importadas desde JSON",
  "Idiomas y motor de traducción de cada libro",
  "Preferencias de lectura, vista y ajustes de IA",
];

const neverSynced = "Nunca se suben tus archivos, su texto, las claves de IA ni el acceso a tus carpetas.";

const resendSeconds = 60;

function formatAgo(iso: string | null, now: number) {
  if (!iso) return "todavía no";
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 10) return "ahora mismo";
  if (seconds < 60) return `hace ${seconds} s`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `hace ${minutes} min` : `hace ${Math.round(minutes / 60)} h`;
}

function SignInForm({ linkError }: { linkError: string | null }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"code" | "email">("email");
  const [busy, setBusy] = useState<"code" | "email" | "google" | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: "error" | "info" } | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (!cooldown) return;
    const timer = window.setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function sendCode(event?: FormEvent) {
    event?.preventDefault();
    setBusy("email");
    setMessage(null);
    try {
      await requestEmailCode(email);
      setStep("code");
      setCooldown(resendSeconds);
      setMessage({
        text: `Te enviamos un correo a ${email.trim()}. Pulsa su enlace en este navegador o, si trae un código, escríbelo aquí. Mira también en el correo no deseado.`,
        tone: "info",
      });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "No fue posible enviar el código.", tone: "error" });
    } finally {
      setBusy(null);
    }
  }

  async function enter(event: FormEvent) {
    event.preventDefault();
    setBusy("code");
    setMessage(null);
    try {
      await verifyEmailCode(email, code);
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "El código no es válido.", tone: "error" });
      setBusy(null);
    }
  }

  async function google() {
    setBusy("google");
    setMessage(null);
    try {
      await signInWithGoogle();
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "No fue posible abrir Google.", tone: "error" });
      setBusy(null);
    }
  }

  return (
    <div className={styles.signIn}>
      {linkError ? (
        <p className={styles.message} data-tone="error" role="alert">
          {linkError}
        </p>
      ) : null}
      <Button disabled={busy !== null} onClick={() => void google()} variant="secondary">
        <span aria-hidden="true" className={styles.googleMark}>
          G
        </span>
        {busy === "google" ? "Abriendo Google…" : "Continuar con Google"}
      </Button>

      <div aria-hidden="true" className={styles.divider}>
        <span>o con tu correo</span>
      </div>

      {step === "email" ? (
        <form className={styles.form} onSubmit={(event) => void sendCode(event)}>
          <Field label="Correo" labelFor="account-email">
            <Input
              autoComplete="email"
              id="account-email"
              inputMode="email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="tu@correo.com"
              required
              type="email"
              value={email}
            />
          </Field>
          <Button disabled={busy !== null || !email.trim()} type="submit">
            {busy === "email" ? "Enviando…" : "Enviarme un acceso"}
          </Button>
        </form>
      ) : (
        <form className={styles.form} onSubmit={(event) => void enter(event)}>
          <Field
            description="Si el correo trae un enlace en vez de un código, basta con pulsarlo: esta pantalla se actualiza sola."
            label="Código del correo"
            labelFor="account-code"
          >
            <Input
              autoComplete="one-time-code"
              autoFocus
              id="account-code"
              inputMode="numeric"
              maxLength={10}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
              pattern="[0-9]*"
              placeholder="123456"
              required
              value={code}
            />
          </Field>
          <div className={styles.row}>
            <Button disabled={busy !== null || code.length < 6} type="submit">
              {busy === "code" ? "Entrando…" : "Entrar"}
            </Button>
            <Button
              disabled={busy !== null || cooldown > 0}
              onClick={() => void sendCode()}
              type="button"
              variant="quiet"
            >
              {cooldown ? `Reenviar en ${cooldown} s` : "Reenviar el correo"}
            </Button>
            <Button
              disabled={busy !== null}
              onClick={() => {
                setStep("email");
                setCode("");
                setMessage(null);
              }}
              type="button"
              variant="quiet"
            >
              Usar otro correo
            </Button>
          </div>
        </form>
      )}

      {message ? (
        <p className={styles.message} data-tone={message.tone} role={message.tone === "error" ? "alert" : "status"}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}

function SyncConsent({ userId }: { userId: string }) {
  const choices = useSyncChoices(userId);
  return (
    <div className={styles.consent}>
      <h3>Qué se sincroniza</h3>
      <ul className={styles.list}>
        {syncedItems.map((item) => (
          <li key={item}>
            <Icon name="check" size={14} />
            {item}
          </li>
        ))}
      </ul>
      <Switch
        checked={choices.catalogAi}
        description="Autor, categoría, editorial, sinopsis… Son derivados de tus libros: solo se suben si lo aceptas."
        label="Fichas hechas por la IA"
        onChange={(event) => setSyncChoices(userId, { catalogAi: event.target.checked })}
      />
      <p className={styles.note}>{neverSynced} Las traducciones guardadas llegarán en el siguiente paso.</p>
    </div>
  );
}

function SignedIn({ email, provider, userId }: { email: string | null; provider: string | null; userId: string }) {
  const choices = useSyncChoices(userId);
  const status = useSyncStatus();
  const lastChange = status.activity.find((entry) => entry.kind === "changes") ?? null;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(timer);
  }, []);

  async function leave() {
    const confirmed = await confirmAction({
      confirmLabel: "Cerrar sesión",
      description: "Tu biblioteca, tus notas y tus ajustes siguen en este equipo; solo deja de sincronizarse.",
      icon: "cloud",
      note: "Tus otros equipos siguen con la sesión abierta.",
      title: "¿Cerrar la sesión en este equipo?",
    });
    if (confirmed) await signOut();
  }

  return (
    <>
      <div className={styles.identity}>
        <span aria-hidden="true" className={styles.avatar}>
          {(email ?? "?").slice(0, 1).toUpperCase()}
        </span>
        <div>
          <strong>{email ?? "Cuenta sin correo"}</strong>
          <small>{provider === "google" ? "Con Google" : "Con código por correo"}</small>
        </div>
        <Button onClick={() => void leave()} size="sm" variant="quiet">
          Cerrar sesión
        </Button>
      </div>

      {choices.enabled ? (
        <>
          <div className={styles.status} data-checking={status.checking || undefined} data-state={status.state}>
            <Icon
              name={status.state === "error" ? "info" : status.state === "syncing" || status.checking ? "refresh" : "cloud"}
              size={18}
            />
            <div className={styles.statusText}>
              <span role="status">
                {status.state === "syncing"
                  ? "Sincronizando…"
                  : status.state === "offline"
                    ? "Sin conexión: se sincronizará al volver."
                    : status.state === "error"
                      ? status.error
                      : status.lastSyncedAt
                        ? `Al día · comprobado ${formatAgo(status.lastSyncedAt, now)}`
                        : "Preparando la primera sincronización…"}
              </span>
              {lastChange ? (
                <small>
                  Última vuelta con cambios: {formatAgo(lastChange.at, now)} · {describeChanges(lastChange)}
                </small>
              ) : null}
            </div>
            <Button
              disabled={status.state === "syncing"}
              onClick={() => void requestSync({ reason: "manual" })}
              size="sm"
              variant="secondary"
            >
              Sincronizar ahora
            </Button>
          </div>
          {status.blockedDeletions ? (
            <div className={styles.row}>
              <Button
                disabled={status.state === "syncing"}
                onClick={() => void requestSync({ allowMassDeletion: true })}
                size="sm"
                variant="quiet"
              >
                Sí, borrar esos {status.blockedDeletions} elementos de mi cuenta
              </Button>
            </div>
          ) : null}
          <SyncDetails status={status} />
          <SyncConsent userId={userId} />
          <div className={styles.row}>
            <Button onClick={() => setSyncChoices(userId, { enabled: false })} size="sm" variant="quiet">
              Pausar la sincronización en este equipo
            </Button>
          </div>
        </>
      ) : (
        <>
          <SyncConsent userId={userId} />
          <div className={styles.row}>
            <Button onClick={() => setSyncChoices(userId, { enabled: true })}>Empezar a sincronizar</Button>
          </div>
          <p className={styles.note}>
            Lo que ya tienes en este equipo se suma a lo de la cuenta: nada se borra al empezar.
          </p>
        </>
      )}
    </>
  );
}

/** Ajustes → Cuenta. Opcional: sin ella, Pliegue sigue siendo local, como siempre. */
/** Solo para quien administra la biblioteca general: un acceso a sus códigos. */
function AdminLink() {
  const admin = useIsPliegueAdmin();
  if (!admin) return null;
  return (
    <p className={styles.note}>
      Administras la <Link href="/app/ajustes/biblioteca-general">biblioteca general</Link>: códigos de acceso y quién entró.
    </p>
  );
}

export function AccountPanel() {
  const account = useAccount();

  return (
    <Card aria-labelledby="account-title" as="section" className={styles.panel}>
      <header className={styles.head}>
        <Tag>{account.status === "signed-in" ? "Sincronizada" : "Opcional"}</Tag>
        <h2 id="account-title">Tu cuenta de Pliegue</h2>
        <p>
          Sin cuenta, todo sigue en este dispositivo, como hasta ahora. Con ella, tu biblioteca te
          sigue a tus otros equipos: tus archivos se quedan donde están y viaja lo que sabes de
          ellos.
        </p>
      </header>

      {account.status === "unavailable" ? (
        <p className={styles.note}>
          Esta instalación no tiene la nube configurada: Pliegue funciona solo en local.
        </p>
      ) : account.status === "loading" ? (
        <p className={styles.note}>Comprobando la sesión…</p>
      ) : account.status === "signed-in" && account.userId ? (
        <SignedIn email={account.email} provider={account.provider} userId={account.userId} />
      ) : (
        <SignInForm linkError={account.linkError} />
      )}
      <AdminLink />
    </Card>
  );
}

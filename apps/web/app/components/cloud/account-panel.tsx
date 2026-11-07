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
import { useOwnSharedLibrary } from "../../cloud/shared-library-store";
import { cloudClient } from "../../cloud/supabase-client";
import { accountDeletionConfirmation } from "../../library-access/account-server";
import { describeChanges } from "../../cloud/sync/sync-activity";
import { confirmAction, type ConfirmOptions } from "../app-ui/confirm-dialog";
import { Icon } from "../app-ui/icons";
import { Skeleton, SkeletonGroup, SkeletonText } from "../app-ui/skeleton";
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

const neverSynced = "Nunca se suben tus archivos, su texto original, las claves de IA ni el acceso a tus carpetas.";

const translationsItem = "Traducciones guardadas: el texto traducido de cada libro";

const resendSeconds = 60;

/**
 * Juntar este equipo con la cuenta mezcla dos ámbitos —lo que vive solo aquí y lo sincronizado—,
 * así que se vuelve a pedir permiso cada vez que se empieza o se reanuda (03.6, decisión del
 * 6-nov): qué se junta, qué sube, qué no sube nunca y cómo volver a separarlos.
 */
function joinConsent(catalogAi: boolean, translations: boolean): ConfirmOptions {
  return {
    confirmLabel: "Juntar y sincronizar",
    description:
      "Lo que tienes en este equipo se junta con lo que ya hay en tu cuenta y, desde ahora, se sincroniza con tus otros equipos. Nada se borra al juntarlos.",
    details: [
      ...syncedItems,
      ...(catalogAi ? ["Fichas hechas por la IA: autor, categoría, editorial, sinopsis…"] : []),
      ...(translations ? [translationsItem] : []),
    ],
    icon: "cloud",
    note: `${neverSynced} Para volver a separarlos, pausa la sincronización en este equipo: lo de aquí se queda aquí.`,
    title: "¿Juntar este equipo con tu cuenta?",
  };
}

/** Subir las fichas de la IA con la sincronización ya en marcha amplía lo que sale: se pregunta. */
const catalogAiConsent: ConfirmOptions = {
  confirmLabel: "Subir las fichas de la IA",
  description: "Las fichas que la IA hizo en este equipo se suben a tu cuenta y llegan a tus otros equipos.",
  details: ["Autor, título y año", "Categoría, subcategoría, géneros y temas", "Editorial, serie, ISBN y sinopsis"],
  icon: "cloud",
  note: "Son derivados de tus libros: el texto de los libros no se sube. Puedes volver a apagarlo cuando quieras.",
  title: "¿Sincronizar también las fichas de la IA?",
};

/**
 * Subir las traducciones siempre se pregunta, se sincronice ya o no: una traducción es el libro
 * entero en otro idioma (decisión del 6-nov, permiso propio y apagado de entrada).
 */
const translationsConsent: ConfirmOptions = {
  confirmLabel: "Subir mis traducciones",
  description:
    "Lo que tradujiste en este equipo se guarda en tu cuenta y llega a tus otros equipos con el mismo libro, sin volver a traducirlo.",
  details: ["El texto traducido de cada página o sección", "Hasta 5 MB por libro e idioma", "200 MB en total por cuenta"],
  icon: "cloud",
  note: "Una traducción contiene el libro entero en otro idioma. Se guarda en una carpeta privada de tu cuenta que solo ves tú. Si lo apagas, deja de subir y bajar; lo ya subido sigue en tu cuenta.",
  title: "¿Sincronizar también tus traducciones?",
};

/** Lo que ocupa, en KB por debajo de 1 MB: «0 MB» no diría nada. */
function formatBytes(bytes: number) {
  const mb = 1024 * 1024;
  if (bytes < mb) return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString("es")} KB`;
  return `${(bytes / mb).toLocaleString("es", { maximumFractionDigits: bytes < 10 * mb ? 1 : 0 })} MB`;
}

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
  const { translations } = useSyncStatus();

  async function changeCatalogAi(next: boolean) {
    // Apagarlo no saca nada nuevo; encenderlo mientras se sincroniza, sí.
    if (next && choices.enabled && !(await confirmAction(catalogAiConsent))) return;
    setSyncChoices(userId, { catalogAi: next });
  }

  async function changeTranslations(next: boolean) {
    if (next && !(await confirmAction(translationsConsent))) return;
    setSyncChoices(userId, { translations: next });
    if (next && choices.enabled) void requestSync({ reason: "manual" });
  }

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
        onChange={(event) => void changeCatalogAi(event.target.checked)}
      />
      <Switch
        checked={choices.translations}
        description="El texto traducido de tus libros, para no traducirlos otra vez en otro equipo. Es el libro entero en otro idioma: solo se sube si lo aceptas."
        label="Traducciones guardadas"
        onChange={(event) => void changeTranslations(event.target.checked)}
      />
      {choices.translations && choices.enabled && translations ? (
        <div className={styles.translationsStatus} data-error={translations.error ? true : undefined}>
          <p role="status">
            {translations.error ??
              (translations.cloudFiles === 0
                ? "Todavía no hay traducciones en tu cuenta: suben cuando llevan dos minutos sin cambiar."
                : null) ??
              `En tu cuenta: ${translations.cloudFiles} ${translations.cloudFiles === 1 ? "traducción" : "traducciones"} · ${formatBytes(translations.cloudBytes)} de 200\u00a0MB`}
          </p>
          {translations.skipped.length ? (
            <ul>
              {translations.skipped.map((item) => (
                <li key={item.itemKey}>
                  {item.reason === "size"
                    ? `Una traducción de ${formatBytes(item.size)} no se sube: pasa de 5\u00a0MB.`
                    : `Una traducción de ${formatBytes(item.size)} no se sube: no cabe en los 200\u00a0MB de tu cuenta.`}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <p className={styles.note}>{neverSynced}</p>
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

  async function join() {
    if (await confirmAction(joinConsent(choices.catalogAi, choices.translations))) setSyncChoices(userId, { enabled: true });
  }

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
          <SyncDetails status={status} userId={userId} />
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
            <Button onClick={() => void join()}>Empezar a sincronizar</Button>
          </div>
          <p className={styles.note}>
            Lo que ya tienes en este equipo se suma a lo de la cuenta: nada se borra al empezar. Antes
            de juntarlos te diremos qué sube.
          </p>
        </>
      )}
    </>
  );
}

/**
 * «Borrar mi cuenta» (02.4, decisión del dueño del 6-nov): se borran la cuenta y lo
 * sincronizado en la nube, y su biblioteca compartida si la tiene; lo del navegador se queda.
 * El aviso lo dice antes, con lo que se pierde renglón a renglón, y no se puede deshacer.
 */
function DeleteAccount({ onDeleted, userId }: { onDeleted: () => void; userId: string }) {
  const own = useOwnSharedLibrary();
  const [state, setState] = useState<{ error: string | null; working: boolean }>({ error: null, working: false });

  async function remove() {
    const confirmed = await confirmAction({
      confirmLabel: "Borrar mi cuenta",
      description: "Se borra tu cuenta de Pliegue y todo lo que se sincronizó en la nube. No se puede deshacer.",
      details: [
        "Favoritos, progreso de lectura, resaltados, notas y recortes sincronizados",
        "Fichas importadas, idiomas de traducción y ajustes guardados en la cuenta",
        ...(own.status === "ready" ? [`Tu biblioteca compartida «${own.library.name}», con sus códigos y su registro de entradas`] : []),
      ],
      icon: "trash",
      note: "Lo guardado en este navegador se queda: tus libros, notas y ajustes siguen aquí, sin cuenta. Para borrarlo también, usa «Borrar todo en este navegador» en Datos.",
      title: "¿Borrar tu cuenta de Pliegue?",
      tone: "danger",
    });
    if (!confirmed) return;
    setState({ error: null, working: true });
    try {
      const session = (await cloudClient()?.auth.getSession())?.data.session;
      if (!session) throw new Error("Tu sesión caducó. Vuelve a entrar y repite el borrado.");
      const response = await fetch("/api/cuenta", {
        body: JSON.stringify({ confirm: accountDeletionConfirmation }),
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        method: "DELETE",
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: unknown };
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "No se pudo borrar la cuenta ahora.");
      // La cuenta ya no existe: este equipo deja de sincronizar con ella y cierra su sesión.
      setSyncChoices(userId, { enabled: false });
      await signOut();
      onDeleted();
    } catch (error) {
      setState({ error: error instanceof Error ? error.message : "No se pudo borrar la cuenta ahora.", working: false });
    }
  }

  return (
    <div className={styles.dangerZone}>
      <div>
        <strong>Borrar mi cuenta</strong>
        <small>Borra la cuenta y lo sincronizado en la nube. Lo de este navegador se queda.</small>
      </div>
      <Button disabled={state.working} onClick={() => void remove()} size="sm" variant="secondary">
        {state.working ? "Borrando…" : "Borrar mi cuenta"}
      </Button>
      {state.error ? (
        <p className={styles.dangerError} role="alert">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}

/** Ajustes → Cuenta. Opcional: sin ella, Pliegue sigue siendo local, como siempre. */
/** Solo para quien administra Pliegue: la biblioteca general y la moderación de las compartidas. */
function AdminLink() {
  const admin = useIsPliegueAdmin();
  if (!admin) return null;
  return (
    <p className={styles.note}>
      Administras la <Link href="/app/ajustes/biblioteca-general">biblioteca general</Link> (códigos de acceso y quién entró) y la{" "}
      <Link href="/app/ajustes/moderacion">moderación</Link> de las bibliotecas compartidas.
    </p>
  );
}

/** La biblioteca compartida de la cuenta: un acceso a sus códigos o, si no tiene, a crearla. */
function OwnLibraryLink() {
  const own = useOwnSharedLibrary();
  if (own.status === "ready") {
    return (
      <p className={styles.note}>
        Tienes la biblioteca compartida <Link href="/app/ajustes/mi-biblioteca">{own.library.name}</Link>: códigos de acceso y quién
        entró.
      </p>
    );
  }
  if (own.status !== "none") return null;
  return (
    <p className={styles.note}>
      Comparte los libros de una carpeta pública de tu Drive con quien tú quieras:{" "}
      <Link href="/app/ajustes/mi-biblioteca">crea tu biblioteca compartida</Link>.
    </p>
  );
}

export function AccountPanel() {
  const account = useAccount();
  const [deleted, setDeleted] = useState(false);

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
        // Vale para quien tiene sesión y para quien no: dos líneas y un botón.
        <SkeletonGroup className={styles.sessionSkeleton} label="Comprobando la sesión">
          <SkeletonText lastWidth="45%" lines={2} />
          <Skeleton height="2.5rem" radius={999} width="11rem" />
        </SkeletonGroup>
      ) : account.status === "signed-in" && account.userId ? (
        <>
          <SignedIn email={account.email} provider={account.provider} userId={account.userId} />
          <DeleteAccount onDeleted={() => setDeleted(true)} userId={account.userId} />
        </>
      ) : (
        <>
          {deleted ? (
            <p className={styles.deletedNotice} role="status">
              Se borró tu cuenta y lo que tenía en la nube. Lo de este navegador sigue aquí.
            </p>
          ) : null}
          <SignInForm linkError={account.linkError} />
        </>
      )}
      <AdminLink />
      <OwnLibraryLink />
    </Card>
  );
}

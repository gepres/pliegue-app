"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import { Button, Card, Field, Input } from "@pliegue/ui";

import { useAccount } from "../../cloud/account-store";
import { useOwnSharedLibrary, type OwnSharedLibrary } from "../../cloud/shared-library-store";
import { cloudClient } from "../../cloud/supabase-client";
import { markNoticeRead, noticeKindLabels, useUserNotices } from "../../cloud/user-notices-store";
import { connectDrive, getDriveToken, preloadDriveConnection, useDriveConnection } from "../../drive/drive-connection";
import { openDrivePicker, preloadDrivePicker } from "../../drive/drive-picker";
import { isSharedLibrarySlug, suggestLibrarySlug } from "../../library-access/library-slug";
import { sharedLibraryTerms, sharedLibraryTermsVersion } from "../../library-access/shared-library-terms";
import { confirmAction } from "../app-ui/confirm-dialog";
import { LibraryCodesManager } from "./library-admin-panel";
import styles from "./library-admin-panel.module.css";

/** Un token de Drive vigente; si no lo hay, pide conectar. Llamar desde un clic. */
async function ensureDriveToken() {
  const current = getDriveToken();
  if (current) return current;
  return (await connectDrive()) === "granted" ? getDriveToken() : null;
}

/** Crear la biblioteca: la carpeta (con el Picker), el nombre, la dirección y las normas. */
function CreateLibraryForm({ email, onCreated }: { email: string | null; onCreated: () => void }) {
  const drive = useDriveConnection();
  const [folder, setFolder] = useState<{ id: string; name: string } | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState(() => suggestLibrarySlug(email ?? ""));
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState<"create" | "folder" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // La ventana de Google y el selector deben abrirse al instante del clic: se cargan antes.
  useEffect(() => {
    if (!drive.configured) return;
    preloadDriveConnection();
    preloadDrivePicker();
  }, [drive.configured]);

  async function pickFolder() {
    setBusy("folder");
    setMessage(null);
    try {
      const token = await ensureDriveToken();
      if (!token) {
        setMessage("Sin conectar Drive no se puede elegir la carpeta.");
        return;
      }
      const [picked] = await openDrivePicker("folder", token);
      if (!picked) return;
      setFolder({ id: picked.id, name: picked.name });
      if (!name.trim()) setName(picked.name);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No fue posible abrir Drive.");
    } finally {
      setBusy(null);
    }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    if (!folder) return setMessage("Elige primero la carpeta de Drive.");
    if (!isSharedLibrarySlug(slug)) return setMessage("La dirección lleva de 2 a 40 letras minúsculas, números y guiones sueltos, y empieza por letra.");
    if (!accepted) return setMessage("Acepta las normas para crear la biblioteca.");
    setBusy("create");
    try {
      const driveToken = await ensureDriveToken();
      const session = (await cloudClient()?.auth.getSession())?.data.session;
      if (!driveToken || !session) {
        setMessage(!session ? "Tu sesión caducó: vuelve a iniciarla en Ajustes → Cuenta." : "Vuelve a conectar Drive para crear la biblioteca.");
        return;
      }
      const response = await fetch("/api/biblioteca/compartidas", {
        body: JSON.stringify({ driveToken, folderId: folder.id, name, slug, termsVersion: sharedLibraryTermsVersion }),
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        method: "POST",
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setMessage(body.error ?? "No fue posible crear la biblioteca.");
        return;
      }
      onCreated();
    } catch {
      setMessage("No hay conexión con Pliegue. Revisa tu internet y vuelve a intentarlo.");
    } finally {
      setBusy(null);
    }
  }

  if (!drive.configured) {
    return <p className={styles.note}>Esta instalación de Pliegue no tiene Google Drive configurado: sin él no se puede crear una biblioteca.</p>;
  }

  return (
    <form className={styles.newCode} noValidate onSubmit={(event) => void create(event)}>
      <section aria-labelledby="owner-folder-title" className={styles.block}>
        <h3 id="owner-folder-title">1. La carpeta</h3>
        <p className={styles.note}>
          Una carpeta de tu Drive con los libros, compartida como «Cualquier persona con el enlace». Si dejas en su raíz el índice
          JSON de Pliegue (<code>pliegue-catalogo….json</code>), se verán títulos, autores y portadas.
        </p>
        <div className={styles.actions}>
          <Button disabled={busy !== null} onClick={() => void pickFolder()} type="button" variant="secondary">
            {busy === "folder" ? "Abriendo Drive…" : folder ? "Elegir otra carpeta" : drive.tokenReady ? "Elegir carpeta" : "Conectar Drive y elegir carpeta"}
          </Button>
          {folder ? (
            <p className={styles.note} role="status">
              Carpeta: <strong>{folder.name}</strong>
            </p>
          ) : null}
        </div>
      </section>

      <section aria-labelledby="owner-name-title" className={styles.block}>
        <h3 id="owner-name-title">2. Nombre y dirección</h3>
        <Field label="Nombre" labelFor="owner-name">
          <Input id="owner-name" maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="Los libros de Ana" value={name} />
        </Field>
        <Field
          description={`Así quedará el enlace: /biblioteca/${slug || "tu-direccion"}. No se puede cambiar después.`}
          label="Dirección"
          labelFor="owner-slug"
        >
          <Input
            autoComplete="off"
            className={styles.mono}
            id="owner-slug"
            maxLength={40}
            onChange={(event) => setSlug(event.target.value.toLowerCase())}
            placeholder="ana-lopez"
            spellCheck={false}
            value={slug}
          />
        </Field>
      </section>

      <section aria-labelledby="owner-terms-title" className={styles.block}>
        <h3 id="owner-terms-title">3. Normas</h3>
        <ul className={styles.terms}>
          {sharedLibraryTerms.map((term) => (
            <li key={term}>{term}</li>
          ))}
        </ul>
        <label className={styles.consent}>
          <input checked={accepted} onChange={(event) => setAccepted(event.target.checked)} type="checkbox" />
          Acepto las normas de las bibliotecas compartidas
        </label>
      </section>

      <div className={styles.actions}>
        <Button disabled={busy !== null} type="submit">
          {busy === "create" ? "Comprobando la carpeta…" : "Crear biblioteca"}
        </Button>
        {message ? (
          <p className={styles.error} role="alert">
            {message}
          </p>
        ) : null}
      </div>
    </form>
  );
}

function noticeDate(iso: string) {
  return new Date(iso).toLocaleString("es", { day: "numeric", hour: "2-digit", minute: "2-digit", month: "short" });
}

/** Lo que Pliegue le dijo al dueño sobre su biblioteca: avisos, incumplimientos y suspensiones. */
function OwnerNotices({ library }: { library: string }) {
  const { notices } = useUserNotices({ library });
  if (!notices.length) return null;
  return (
    <section aria-labelledby="owner-notices-title" className={styles.block}>
      <h3 id="owner-notices-title">Avisos de Pliegue</h3>
      <ol className={styles.events}>
        {notices.map((notice) => (
          <li key={notice.id}>
            <strong>
              {notice.title}
              {notice.read_at ? null : <span className={styles.returned}>nuevo</span>}
            </strong>
            <span>{noticeKindLabels[notice.kind]}</span>
            {notice.read_at ? null : (
              <Button className={styles.removeEntry} onClick={() => void markNoticeRead(notice.id)} size="sm" variant="quiet">
                Entendido
              </Button>
            )}
            <small>
              {noticeDate(notice.created_at)}
              {notice.body ? ` · ${notice.body}` : ""}
            </small>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Nombre, pausa y borrado de la biblioteca: lo que su dueño puede cambiar. Suspendida, solo el nombre. */
function LibrarySettings({ library, onChanged }: { library: OwnSharedLibrary; onChanged: () => void }) {
  const suspended = Boolean(library.suspended_at);
  const [name, setName] = useState(library.name);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const path = `/biblioteca/${library.slug}`;

  async function update(changes: Partial<Pick<OwnSharedLibrary, "active" | "name">>, done: string) {
    const client = cloudClient();
    if (!client) return;
    setBusy(true);
    const { error } = await client.from("shared_libraries").update(changes).eq("slug", library.slug);
    setBusy(false);
    setMessage(error ? (error.message ?? "No fue posible guardar el cambio.") : done);
    if (!error) onChanged();
  }

  async function remove() {
    const confirmed = await confirmAction({
      confirmLabel: "Borrar biblioteca",
      description: `Se borran ${path}, sus códigos y su registro de entradas. Los libros siguen en tu carpeta de Drive.`,
      icon: "trash",
      note: "Si solo quieres que nadie entre por un tiempo, pausa la biblioteca.",
      title: `¿Borrar «${library.name}»?`,
      tone: "danger",
    });
    if (!confirmed) return;
    const client = cloudClient();
    if (!client) return;
    setBusy(true);
    const { error } = await client.from("shared_libraries").delete().eq("slug", library.slug);
    setBusy(false);
    if (error) setMessage(error.message ?? "No fue posible borrar la biblioteca.");
    else onChanged();
  }

  const trimmed = name.normalize("NFC").replace(/\s+/g, " ").trim();
  return (
    <section aria-labelledby="owner-settings-title" className={styles.block}>
      <h3 id="owner-settings-title">Biblioteca</h3>
      <p className={styles.note}>
        Dirección: <Link href={path}>{path}</Link> ·{" "}
        <a href={`https://drive.google.com/drive/folders/${encodeURIComponent(library.folder_id)}`} rel="noreferrer" target="_blank">
          abrir la carpeta en Drive
        </a>
      </p>
      <form
        className={styles.codeRow}
        onSubmit={(event) => {
          event.preventDefault();
          if (trimmed && trimmed !== library.name) void update({ name: trimmed.slice(0, 80) }, "Nombre guardado.");
        }}
      >
        <Field label="Nombre" labelFor="owner-rename">
          <Input id="owner-rename" maxLength={80} onChange={(event) => setName(event.target.value)} value={name} />
        </Field>
        <Button disabled={busy || !trimmed || trimmed === library.name} size="sm" type="submit" variant="secondary">
          Guardar nombre
        </Button>
      </form>
      {suspended ? null : (
        <div className={styles.codeActions}>
          <Button
            disabled={busy}
            onClick={() =>
              void update(
                { active: !library.active },
                library.active ? "Pausada: nadie puede entrar hasta que la reanudes." : "Reanudada: se vuelve a entrar con los códigos activos.",
              )
            }
            size="sm"
            variant="quiet"
          >
            {library.active ? "Pausar" : "Reanudar"}
          </Button>
          <Button disabled={busy} onClick={() => void remove()} size="sm" variant="danger">
            Borrar biblioteca
          </Button>
        </div>
      )}
      {message ? (
        <p className={styles.note} role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}

/**
 * Ajustes → Mi biblioteca compartida: crearla y, después, lo mismo que el administrador tiene
 * para la general, sobre la biblioteca de esta cuenta: los códigos, quién entró y quitar a alguien.
 */
export function SharedLibraryOwnerPanel() {
  const account = useAccount();
  const own = useOwnSharedLibrary();
  const path = own.status === "ready" ? `/biblioteca/${own.library.slug}` : null;

  const header = (
    <header className={styles.head}>
      <h2 id="library-admin-title">{own.status === "ready" ? own.library.name : "Crea tu biblioteca compartida"}</h2>
      {path ? (
        <p>
          Los códigos con los que se entra en <Link href={path}>{path}</Link> y quién entró con ellos. Desactivar un código
          corta el acceso en la próxima visita de quien lo usó.
        </p>
      ) : (
        <p>
          Comparte los libros de una carpeta pública de tu Drive, como la biblioteca general: quien tenga un código tuyo entra sin
          cuenta, y tú ves quién entró.
        </p>
      )}
    </header>
  );

  if (own.status === "signed-out") {
    return (
      <Card aria-labelledby="library-admin-title" as="section" className={styles.panel}>
        {header}
        <p className={styles.note}>
          Inicia sesión con tu cuenta en <Link href="/app/ajustes#cuenta">Ajustes → Cuenta</Link> para crear o ver tu biblioteca
          compartida.
        </p>
      </Card>
    );
  }
  if (own.status === "loading") {
    return (
      <Card aria-labelledby="library-admin-title" as="section" className={styles.panel}>
        {header}
        <p className={styles.note}>Comprobando tu cuenta…</p>
      </Card>
    );
  }
  if (own.status === "none") {
    return (
      <Card aria-labelledby="library-admin-title" as="section" className={styles.panel}>
        {header}
        <CreateLibraryForm email={account.email} onCreated={own.reload} />
      </Card>
    );
  }

  return (
    <Card aria-labelledby="library-admin-title" as="section" className={styles.panel}>
      {header}
      {own.library.suspended_at ? (
        <p className={styles.error} role="status">
          Suspendida por la moderación de Pliegue{own.library.suspended_reason ? `: ${own.library.suspended_reason}` : ""}. Mientras lo
          esté nadie puede entrar, y no puedes reanudarla ni borrarla.
        </p>
      ) : own.library.active ? null : (
        <p className={styles.warning} role="status">
          Está pausada: nadie puede entrar, ni con un código activo, hasta que la reanudes.
        </p>
      )}
      <OwnerNotices library={own.library.slug} />
      <LibrarySettings key={`${own.library.slug}:${own.library.name}`} library={own.library} onChanged={own.reload} />
      <LibraryCodesManager library={own.library.slug} libraryPath={`/biblioteca/${own.library.slug}`} userId={account.userId ?? ""} />
    </Card>
  );
}

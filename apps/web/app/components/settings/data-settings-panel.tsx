"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Button, Card, Tag } from "@pliegue/ui";

import { signOut, useAccount } from "../../cloud/account-store";
import { syncCollections, type SyncContext } from "../../cloud/sync/collections";
import { indexLibraryKeys } from "../../cloud/sync/document-key";
import { collectionNames } from "../../cloud/sync/sync-activity";
import { readLocalSource } from "../../cloud/sync/sync-controller";
import { holdSync } from "../../cloud/sync/sync-hold";
import { useAnnotationStore } from "../../library/annotation-store";
import {
  applyRestore,
  backupFileName,
  createBackup,
  parseBackup,
  planRestore,
  type PliegueBackup,
  type RestorePlan,
} from "../../library/backup";
import { browserDataEnv, inventorySize, wipeBrowserData, type WipeResult } from "../../library/browser-data";
import { notesFileName, notesToMarkdown } from "../../library/notes-export";
import { clearAllTranslations, countTranslatedUnits } from "../../library/translation-store";
import { confirmAction } from "../app-ui/confirm-dialog";
import { Icon } from "../app-ui/icons";
import { downloadBlob } from "../postcard/postcard-share";
import styles from "./data-settings-panel.module.css";

const plural = (count: number, one: string, many: string) => `${count.toLocaleString("es")} ${count === 1 ? one : many}`;

function nameOf(collection: string, count: number) {
  const names = collectionNames[collection];
  return names ? plural(count, names.one, names.many) : `${count} ${collection}`;
}

function longDate(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? "fecha desconocida"
    : date.toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" });
}

/** Lo de este equipo como lo ve la sincronización, o `null` si la biblioteca aún carga. */
async function localContext(): Promise<SyncContext | null> {
  const local = readLocalSource();
  if (!local?.ready) return null;
  return { keys: await indexLibraryKeys(local.documents), local: local.snapshot, now: new Date().toISOString() };
}

const stillLoading = "La biblioteca aún está cargando. Vuelve a intentarlo en un momento.";

/* ---- Copia de seguridad y restaurar ----------------------------------------------------- */

function BackupSection() {
  const account = useAccount();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [restore, setRestore] = useState<{ backup: PliegueBackup; fileName: string; plan: RestorePlan } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function download() {
    setBusy(true);
    setMessage(null);
    try {
      const context = await localContext();
      if (!context) {
        setMessage(stillLoading);
        return;
      }
      const backup = createBackup(syncCollections, context);
      const blob = new Blob([`${JSON.stringify(backup, null, 2)}\n`], { type: "application/json" });
      downloadBlob(blob, backupFileName(backup.createdAt));
      const parts = Object.entries(backup.collections)
        .filter(([, entries]) => entries.length)
        .map(([name, entries]) => nameOf(name, entries.length));
      setMessage(
        parts.length
          ? `Descargada «${backupFileName(backup.createdAt)}» con ${parts.join(", ")}.`
          : "Descargada la copia, pero todavía no hay nada que guardar: ni favoritos, ni avance, ni notas.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No fue posible preparar la copia.");
    } finally {
      setBusy(false);
    }
  }

  async function choose(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setMessage(null);
    setRestore(null);
    try {
      if (file.size > 50 * 1024 * 1024) throw new Error("Este archivo es demasiado grande para ser una copia de Pliegue.");
      let raw: unknown;
      try {
        raw = JSON.parse(await file.text());
      } catch {
        throw new Error("Este archivo no es una copia de seguridad de Pliegue.");
      }
      const backup = parseBackup(raw);
      const context = await localContext();
      if (!context) {
        setMessage(stillLoading);
        return;
      }
      setRestore({ backup, fileName: file.name, plan: planRestore(backup, syncCollections, context) });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No fue posible leer la copia.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function confirmRestore() {
    if (!restore) return;
    setBusy(true);
    // Una sola vuelta de sincronización al terminar, con todo ya escrito.
    const release = holdSync();
    try {
      const context = await localContext();
      if (!context) {
        setMessage(stillLoading);
        return;
      }
      // Se recalcula con lo que hay ahora: pudo cambiar algo desde la vista previa.
      const applied = await applyRestore(planRestore(restore.backup, syncCollections, context), syncCollections, context);
      setRestore(null);
      setMessage(
        applied
          ? `Restaurado: ${plural(applied, "elemento", "elementos")}.${account.status === "signed-in" ? " Si sincronizas, subirán a tu cuenta en la próxima vuelta." : ""}`
          : "No había nada nuevo que restaurar: este equipo ya tenía todo lo de la copia.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No fue posible restaurar la copia.");
    } finally {
      release();
      setBusy(false);
    }
  }

  const rows = restore
    ? Object.entries(restore.plan.collections).filter(([, counts]) => counts.incoming > 0)
    : [];
  const toApply = rows.reduce((total, [, counts]) => total + counts.apply, 0);
  const waiting = rows.reduce((total, [, counts]) => total + counts.waiting, 0);

  return (
    <section aria-labelledby="backup-title" className={styles.block}>
      <h3 id="backup-title">Copia de seguridad</h3>
      <p className={styles.note}>
        Un archivo con lo que has hecho con tus libros: favoritos, avance, notas y resaltados, fichas, idiomas de
        traducción y ajustes. Sirve para guardarlo fuera del navegador o llevarlo a otro equipo sin cuenta. No lleva los
        libros ni su texto, ni los permisos de tus carpetas, ni tus claves de IA, que Pliegue no guarda nunca.
      </p>
      <div className={styles.actions}>
        <Button disabled={busy} onClick={() => void download()} size="sm">
          <Icon name="download" size={16} />
          Descargar copia
        </Button>
        <Button disabled={busy} onClick={() => input.current?.click()} size="sm" variant="secondary">
          <Icon name="refresh" size={16} />
          Restaurar una copia…
        </Button>
        <input
          accept=".json,application/json"
          aria-label="Archivo de copia de seguridad"
          className={styles.fileInput}
          onChange={(event) => void choose(event.target.files?.[0])}
          ref={input}
          type="file"
        />
      </div>

      {restore ? (
        <div aria-labelledby="restore-title" className={styles.preview} role="region">
          <h4 id="restore-title">
            «{restore.fileName}» · copia del {longDate(restore.backup.createdAt)}
          </h4>
          {rows.length ? (
            <ul className={styles.plan}>
              {rows.map(([name, counts]) => (
                <li key={name}>
                  <strong>{collectionNames[name]?.label ?? name}</strong>
                  <span>
                    {counts.incoming.toLocaleString("es")} en la copia
                    {counts.apply ? ` · ${plural(counts.apply, "se aplicará", "se aplicarán")}` : ""}
                    {counts.kept ? ` · ${plural(counts.kept, "ya estaba", "ya estaban")}` : ""}
                    {counts.waiting ? ` · ${counts.waiting.toLocaleString("es")} sin su libro aquí` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.note}>La copia está vacía.</p>
          )}
          <p className={styles.note}>
            Restaurar no borra nada: suma lo que falta y, si algo choca, gana el avance mayor y la nota más reciente.
            {waiting
              ? " Lo de libros que no están en este equipo no se aplica: vincula su carpeta y vuelve a restaurar la copia."
              : ""}
          </p>
          <div className={styles.actions}>
            <Button disabled={busy || !toApply} onClick={() => void confirmRestore()} size="sm">
              {busy ? "Restaurando…" : toApply ? `Restaurar ${plural(toApply, "elemento", "elementos")}` : "Nada que restaurar"}
            </Button>
            <Button disabled={busy} onClick={() => setRestore(null)} size="sm" variant="quiet">
              Cancelar
            </Button>
          </div>
        </div>
      ) : null}

      {message ? (
        <p className={styles.note} role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}

/* ---- Exportar ------------------------------------------------------------------------- */

function ExportSection() {
  const annotations = useAnnotationStore();
  const [message, setMessage] = useState<string | null>(null);
  const count = annotations.annotations.length;
  const books = new Set(annotations.annotations.map((annotation) => annotation.documentId)).size;

  function download() {
    const now = new Date().toISOString();
    const markdown = notesToMarkdown(annotations.annotations, now);
    downloadBlob(new Blob([markdown], { type: "text/markdown;charset=utf-8" }), notesFileName(now));
    setMessage(`Descargado «${notesFileName(now)}».`);
  }

  return (
    <section aria-labelledby="export-title" className={styles.block}>
      <h3 id="export-title">Exportar</h3>
      <ul className={styles.rows}>
        <li>
          <Icon name="note" size={18} />
          <div className={styles.rowText}>
            <strong>Notas y resaltados en Markdown</strong>
            <small>
              {annotations.status !== "ready"
                ? "Cargando…"
                : count
                  ? `${plural(count, "marca", "marcas")} en ${plural(books, "libro", "libros")}, con su cita y su página. Se abre en cualquier editor u Obsidian.`
                  : "Todavía no hay notas ni resaltados."}
            </small>
          </div>
          <Button disabled={!count} onClick={download} size="sm" variant="secondary">
            Descargar .md
          </Button>
        </li>
        <li>
          <Icon name="file" size={18} />
          <div className={styles.rowText}>
            <strong>Fichas de tus libros en JSON</strong>
            <small>Título, autor, categoría y resumen de cada libro, en el formato del índice que Pliegue importa.</small>
          </div>
          <Link className={styles.action} href="/app/biblioteca/fuentes#indice-json">
            Ir al índice
          </Link>
        </li>
      </ul>
      {message ? (
        <p className={styles.note} role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}

/* ---- Borrar -------------------------------------------------------------------------- */

function EraseSection() {
  const [translations, setTranslations] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wipe, setWipe] = useState<WipeResult | null>(null);

  useEffect(() => {
    void countTranslatedUnits()
      .then(setTranslations)
      .catch(() => setTranslations(0));
  }, []);

  async function eraseTranslations() {
    const confirmed = await confirmAction({
      confirmLabel: "Borrar traducciones",
      description: `Se borran ${plural(translations ?? 0, "fragmento traducido", "fragmentos traducidos")} de todos tus libros.`,
      icon: "trash",
      note: "Al volver a leer en otro idioma, se traducen de nuevo: con tu IA, eso vuelve a gastar.",
      title: "¿Borrar las traducciones guardadas?",
      tone: "danger",
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      const removed = await clearAllTranslations();
      setTranslations(await countTranslatedUnits());
      setMessage(`Se borraron ${plural(removed, "fragmento traducido", "fragmentos traducidos")}.`);
    } catch {
      setMessage("No fue posible borrar las traducciones.");
    } finally {
      setBusy(false);
    }
  }

  async function eraseEverything() {
    const confirmed = await confirmAction({
      confirmLabel: "Borrar todo",
      description: "Pliegue vuelve a empezar en este navegador, como recién instalado.",
      details: [
        "Los índices de tus carpetas y de Google Drive, y sus permisos",
        "Las copias importadas",
        "Favoritos, avance, notas y resaltados",
        "Las fichas, las traducciones y las portadas",
        "Tus ajustes, y la sesión de tu cuenta",
      ],
      icon: "trash",
      note: "No toca tus archivos, tu carpeta, Google Drive ni lo guardado en tu cuenta. Si sincronizas, al volver a iniciar sesión recuperas favoritos, avance y notas. Si no, descarga antes una copia de seguridad.",
      title: "¿Borrar todo lo de Pliegue en este navegador?",
      tone: "danger",
    });
    if (!confirmed) return;
    setBusy(true);
    setMessage(null);
    // Nada debe sincronizarse mientras se vacía: una vuelta vería todo borrado. No se suelta:
    // la página se recarga al terminar.
    holdSync();
    try {
      await signOut();
    } catch {
      // Sin red, la sesión se borra igual con el almacenamiento.
    }
    const result = await wipeBrowserData(browserDataEnv());
    setWipe(result);
    setBusy(false);
    if (!inventorySize(result.remaining) && !result.blocked.length) {
      window.setTimeout(() => window.location.assign("/app"), 2500);
    }
  }

  if (wipe) {
    const clean = !inventorySize(wipe.remaining) && !wipe.blocked.length;
    const removed = inventorySize(wipe.removed);
    return (
      <section aria-labelledby="erase-title" className={styles.block}>
        <h3 id="erase-title">Borrar</h3>
        <div className={styles.status} data-tone={clean ? "ok" : "warn"}>
          <Icon name={clean ? "check" : "info"} size={18} />
          <p role="status">
            {clean
              ? `Borrado y comprobado: no queda nada de Pliegue en este navegador (${plural(removed, "elemento", "elementos")}). Volviendo al inicio…`
              : wipe.blocked.length
                ? `Casi todo borrado. ${plural(wipe.blocked.length, "base sigue abierta", "bases siguen abiertas")} en otra pestaña de Pliegue: ciérrala y se borrará sola.`
                : `Quedaron ${plural(inventorySize(wipe.remaining), "elemento", "elementos")} que el navegador no dejó borrar. Puedes borrarlos desde los datos del sitio en la configuración del navegador.`}
          </p>
          {!clean ? (
            <Button onClick={() => window.location.assign("/app")} size="sm" variant="secondary">
              Ir al inicio
            </Button>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="erase-title" className={styles.block}>
      <h3 id="erase-title">Borrar</h3>
      <ul className={styles.rows}>
        <li>
          <Icon name="translate" size={18} />
          <div className={styles.rowText}>
            <strong>Traducciones guardadas</strong>
            <small>
              {translations === null
                ? "Contando…"
                : translations
                  ? `${plural(translations, "fragmento traducido", "fragmentos traducidos")}. Se guardan para no volver a pagar por ellas.`
                  : "No hay traducciones guardadas."}
            </small>
          </div>
          <Button disabled={busy || !translations} onClick={() => void eraseTranslations()} size="sm" variant="secondary">
            Borrar
          </Button>
        </li>
        <li>
          <Icon name="trash" size={18} />
          <div className={styles.rowText}>
            <strong>Todo lo de Pliegue en este navegador</strong>
            <small>
              Índices, copias importadas, notas, avance, fichas, traducciones, ajustes y la sesión. Tus archivos y lo
              guardado en tu cuenta no se tocan.
            </small>
          </div>
          <Button disabled={busy} onClick={() => void eraseEverything()} size="sm" variant="danger">
            {busy ? "Borrando…" : "Borrar todo"}
          </Button>
        </li>
      </ul>
      {message ? (
        <p className={styles.note} role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}

/* ---- Dónde vive cada cosa ------------------------------------------------------------- */

function RetentionSection() {
  return (
    <section aria-labelledby="retention-title" className={styles.block}>
      <h3 id="retention-title">Dónde vive cada cosa</h3>
      <dl className={styles.retention}>
        <div>
          <dt>Tus libros</dt>
          <dd>En tu carpeta o en tu Google Drive. Pliegue los lee donde están; solo las copias importadas viven en el navegador.</dd>
        </div>
        <div>
          <dt>Lo que haces con ellos</dt>
          <dd>
            Avance, notas, favoritos, fichas y traducciones se guardan en este navegador hasta que los borres. Si activas la
            sincronización, también en tu cuenta, para tus otros equipos.
          </dd>
        </div>
        <div>
          <dt>Tus claves de IA</dt>
          <dd>
            Solo en la memoria de la pestaña: se olvidan al cerrarla. Lo que pides traducir o catalogar pasa por Pliegue
            sin guardarse y llega, con tu clave, al proveedor que elegiste.
          </dd>
        </div>
      </dl>
      <p className={styles.note}>
        Cuánto ocupa y si el navegador puede borrarlo está en <Link href="/app/ajustes#fuentes">Fuentes</Link>; la
        sincronización, en <Link href="/app/ajustes#cuenta">Cuenta y sincronización</Link>.
      </p>
    </section>
  );
}

/** Ajustes → Datos y portabilidad: llevarse lo tuyo, traerlo de vuelta y borrarlo. */
export function DataSettingsPanel() {
  return (
    <Card aria-labelledby="data-settings-title" as="section" className={styles.panel}>
      <header className={styles.head}>
        <Tag>Tus datos</Tag>
        <h2 id="data-settings-title">Datos y portabilidad</h2>
        <p>Llévate lo que has hecho con tus libros, tráelo de vuelta en otro equipo o bórralo de este navegador.</p>
      </header>
      <BackupSection />
      <ExportSection />
      <EraseSection />
      <RetentionSection />
    </Card>
  );
}

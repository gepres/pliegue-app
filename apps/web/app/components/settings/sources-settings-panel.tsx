"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Button, Card, Tag } from "@pliegue/ui";

import { useDriveConnection } from "../../drive/drive-connection";
import { useDriveLibrary } from "../../library/drive-library-store";
import { useLinkedFiles } from "../../library/local-file-reference-store";
import { requestLinkedFolderReadPermission, useLinkedFolders } from "../../library/local-folder-store";
import { useImportedDocuments } from "../../library/local-library-store";
import { protectStorage, readStorageState, type StorageState } from "../../library/storage-protection";
import { Icon } from "../app-ui/icons";
import { describeDrive, folderPermission, formatBytes, summarizeFiles } from "./sources-summary";
import styles from "./sources-settings-panel.module.css";

const sourcesPage = "/app/biblioteca/fuentes";

function lastScan(iso: string | null) {
  if (!iso) return "sin revisar todavía";
  const date = new Date(iso).toLocaleString("es", { day: "numeric", hour: "2-digit", minute: "2-digit", month: "short" });
  return `revisada el ${date}`;
}

const plural = (count: number, one: string, many: string) => `${count.toLocaleString("es")} ${count === 1 ? one : many}`;

/** De dónde salen los libros y si Pliegue puede leerlos ahora. Para gestionarlos, Biblioteca → Fuentes. */
function LocationsSection() {
  const folders = useLinkedFolders();
  const files = useLinkedFiles();
  const imported = useImportedDocuments();
  const drive = useDriveConnection();
  const driveLibrary = useDriveLibrary();
  const [asking, setAsking] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const looseFiles = summarizeFiles(files.documents);
  const copies = summarizeFiles(imported.documents);
  const driveSummary = describeDrive({
    authorized: drive.authorized,
    configured: drive.configured,
    email: drive.email,
    files: driveLibrary.documents.length,
    folders: driveLibrary.sources.length,
    readonly: drive.readonly,
    tokenReady: drive.tokenReady,
  });

  async function askPermission(sourceId: string, name: string) {
    setAsking(sourceId);
    setMessage(null);
    try {
      // Primera espera: el navegador solo pregunta durante el gesto de la persona.
      const outcome = await requestLinkedFolderReadPermission(sourceId);
      setMessage(
        outcome === "granted"
          ? `«${name}» ya tiene permiso: sus libros se abren de nuevo.`
          : outcome === "unanswered"
            ? "El navegador no llegó a preguntar. Vuelve a pulsar «Dar permiso»."
            : `El navegador no dio permiso a «${name}». Puedes volver a intentarlo o revisar los permisos del sitio.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No fue posible pedir el permiso.");
    } finally {
      setAsking(null);
    }
  }

  return (
    <section aria-labelledby="locations-title" className={styles.block}>
      <h3 id="locations-title">Ubicaciones conectadas</h3>
      <ul className={styles.locations}>
        {folders.sources.length ? (
          folders.sources.map((source) => {
            const permission = folderPermission(source.permission);
            return (
              <li key={source.id}>
                <Icon name="folder" size={18} />
                <div className={styles.locationText}>
                  <strong>{source.name}</strong>
                  <small>
                    Carpeta de este equipo · {plural(source.fileCount, "archivo", "archivos")} · {lastScan(source.lastScannedAt)}
                  </small>
                  <span className={styles.badge} data-tone={permission.tone}>
                    {permission.label}
                  </span>
                </div>
                {permission.action ? (
                  <Button
                    disabled={asking === source.id}
                    onClick={() => void askPermission(source.id, source.name)}
                    size="sm"
                    variant="secondary"
                  >
                    {asking === source.id ? "Pidiendo…" : "Dar permiso"}
                  </Button>
                ) : null}
              </li>
            );
          })
        ) : (
          <li>
            <Icon name="folder" size={18} />
            <div className={styles.locationText}>
              <strong>Carpetas de este equipo</strong>
              <small>{folders.status === "ready" ? "Ninguna vinculada todavía." : "Cargando…"}</small>
            </div>
            <Link className={styles.action} href={sourcesPage}>
              Vincular una carpeta
            </Link>
          </li>
        )}

        {looseFiles.count ? (
          <li>
            <Icon name="file" size={18} />
            <div className={styles.locationText}>
              <strong>Archivos sueltos</strong>
              <small>
                {plural(looseFiles.count, "archivo", "archivos")} · {formatBytes(looseFiles.bytes)} en su sitio original
              </small>
              {looseFiles.needPermission ? (
                <span className={styles.badge} data-tone="warn">
                  {plural(looseFiles.needPermission, "pide", "piden")} permiso
                </span>
              ) : (
                <span className={styles.badge} data-tone="ok">
                  Con permiso
                </span>
              )}
            </div>
            <Link className={styles.action} href={`${sourcesPage}#archivos`}>
              Revisar
            </Link>
          </li>
        ) : null}

        {copies.count ? (
          <li>
            <Icon name="database" size={18} />
            <div className={styles.locationText}>
              <strong>Copias importadas</strong>
              <small>
                {plural(copies.count, "copia", "copias")} · {formatBytes(copies.bytes)} guardados dentro de este navegador
              </small>
            </div>
          </li>
        ) : null}

        <li>
          <Icon name="cloud" size={18} />
          <div className={styles.locationText}>
            <strong>Google Drive</strong>
            <small>{driveSummary.headline}</small>
            {driveSummary.details.map((detail) => (
              <small key={detail}>{detail}</small>
            ))}
          </div>
          {driveSummary.state !== "unconfigured" ? (
            <Link className={styles.action} href={`${sourcesPage}#drive`}>
              {driveSummary.state === "connected" ? "Gestionar" : "Conectar"}
            </Link>
          ) : null}
        </li>
      </ul>
      {message ? (
        <p className={styles.note} role="status">
          {message}
        </p>
      ) : null}
      <p className={styles.note}>
        Para vincular, quitar o buscar cambios, ve a <Link href={sourcesPage}>Biblioteca → Fuentes</Link>.
      </p>
    </section>
  );
}

/** Si el navegador puede borrar lo que Pliegue guarda aquí, y cuánto ocupa. */
function StorageSection() {
  const [state, setState] = useState<StorageState | null>(null);
  const [asking, setAsking] = useState(false);
  const [denied, setDenied] = useState(false);
  const refresh = useCallback(() => {
    void readStorageState().then(setState);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function protect() {
    setAsking(true);
    const granted = await protectStorage();
    setDenied(!granted);
    setAsking(false);
    refresh();
  }

  if (!state) return <p className={styles.note}>Comprobando el almacenamiento…</p>;

  const share = state.usage !== null && state.quota ? Math.min(100, (state.usage / state.quota) * 100) : null;
  const breakdown = state.breakdown
    ? [
        { bytes: state.breakdown.databases, label: "Índices, notas, fichas, traducciones y portadas" },
        { bytes: state.breakdown.files, label: "Copias importadas" },
        { bytes: state.breakdown.appFiles, label: "La app, para abrirla sin conexión" },
      ].filter((item) => item.bytes > 0)
    : [];

  return (
    <section aria-labelledby="storage-title" className={styles.block}>
      <h3 id="storage-title">Tus datos en este navegador</h3>
      {!state.supported ? (
        <p className={styles.note}>Este navegador no permite consultar ni proteger el almacenamiento de Pliegue.</p>
      ) : (
        <>
          <div className={styles.status} data-tone={state.persisted ? "ok" : "warn"}>
            <Icon name={state.persisted ? "check" : "info"} size={18} />
            <p role="status">
              {state.persisted
                ? "Protegidos: el navegador no los borrará aunque se quede sin espacio."
                : state.persisted === null
                  ? "Este navegador no dice si tus datos están protegidos."
                  : "Sin proteger: si el disco se llena, el navegador puede borrar tus índices, notas y traducciones sin avisar."}
            </p>
            {state.persisted === false ? (
              <Button disabled={asking} onClick={() => void protect()} size="sm" variant="secondary">
                {asking ? "Pidiendo…" : "Proteger mis datos"}
              </Button>
            ) : null}
          </div>
          {denied && !state.persisted ? (
            <p className={styles.note} role="status">
              El navegador no lo concedió. Chrome lo concede cuando Pliegue está{" "}
              <Link href="/app/ajustes#espacio">instalado como app</Link> o en tus marcadores; después, vuelve a pulsar
              «Proteger mis datos».
            </p>
          ) : null}
          {state.usage !== null ? (
            <div className={styles.usage}>
              <p>
                Pliegue ocupa <strong>{formatBytes(state.usage)}</strong>
                {state.quota ? ` · quedan ${formatBytes(Math.max(0, state.quota - state.usage))} disponibles` : ""}
              </p>
              {share !== null ? (
                <div aria-hidden="true" className={styles.meter}>
                  <span style={{ width: `${Math.max(share, 0.5)}%` }} />
                </div>
              ) : null}
              {breakdown.length ? (
                <ul className={styles.breakdown}>
                  {breakdown.map((item) => (
                    <li key={item.label}>
                      <span>{item.label}</span>
                      <strong>{formatBytes(item.bytes)}</strong>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </>
      )}
      <p className={styles.note}>
        Tus libros originales no cuentan aquí: siguen en tu carpeta o en Google Drive. Solo las copias importadas se
        guardan dentro del navegador.
      </p>
    </section>
  );
}

/** Ajustes → Fuentes: de dónde salen los libros y cómo se guarda en este navegador lo que Pliegue sabe de ellos. */
export function SourcesSettingsPanel() {
  return (
    <Card aria-labelledby="sources-settings-title" as="section" className={styles.panel}>
      <header className={styles.head}>
        <Tag>Este navegador</Tag>
        <h2 id="sources-settings-title">Fuentes y datos</h2>
        <p>
          De dónde salen tus libros, si Pliegue puede leerlos ahora y cómo se guarda en este navegador lo que sabe de
          ellos.
        </p>
      </header>
      <LocationsSection />
      <StorageSection />
    </Card>
  );
}

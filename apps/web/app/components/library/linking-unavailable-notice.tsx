"use client";

import Link from "next/link";

import { Button, buttonClassName } from "@pliegue/ui";

import { Icon } from "../app-ui/icons";
import styles from "../../(workspace)/app/workspace.module.css";

type Blocker = "address" | "browser" | "device";

/**
 * Por qué no se puede vincular aquí. El acceso a archivos del navegador solo existe en Chrome y
 * Edge de escritorio, y solo en una dirección segura (HTTPS o localhost). En un teléfono o una
 * tableta no hay nada que arreglar: se importa. En escritorio, lo habitual es haber entrado por
 * la IP de la red local, sin HTTPS; si no, es el navegador.
 */
function linkingBlocker(): Blocker {
  if (window.matchMedia("(pointer: coarse)").matches) return "device";
  return window.isSecureContext ? "browser" : "address";
}

const titles: Record<Blocker, string> = {
  address: "Esta dirección no permite vincular carpetas",
  browser: "Este navegador no permite vincular carpetas",
  device: "En este dispositivo no se pueden vincular carpetas",
};

/**
 * Solo se pinta en el navegador, cuando ya se sabe que no hay acceso: puede leer `window`.
 * Sin `onImport` (en Fuentes no hay selector de archivos), lleva a importar en la Biblioteca.
 */
export function LinkingUnavailableNotice({ onImport }: { onImport?: () => void }) {
  const blocker = linkingBlocker();
  const { host, hostname, pathname, port, protocol } = window.location;
  const localUrl = `${protocol}//localhost${port ? `:${port}` : ""}${pathname}`;

  return (
    <div className={`${styles.capabilityNote} ${styles.capabilityNoteWarn}`} role="note">
      <span aria-hidden="true" className={styles.capabilityIcon}>
        <Icon name="link" size={18} />
      </span>
      <div className={styles.capabilityBody}>
        <strong>{titles[blocker]}</strong>
        <p>
          {blocker === "address"
            ? `Estás en ${host}, sin HTTPS, y el navegador bloquea ahí el acceso a tus archivos. Si Pliegue corre en este equipo, ábrelo en localhost; si no, hace falta HTTPS.`
            : "Vincular archivos y carpetas sin copiarlos solo funciona en Chrome y Edge de escritorio."}{" "}
          Aquí puedes importar copias: se guardan solo en este dispositivo.
        </p>
        <div className={styles.localImportActions}>
          {onImport ? (
            <Button onClick={onImport} size="sm" variant="secondary">
              Importar copias
            </Button>
          ) : (
            <Link className={buttonClassName({ size: "sm", variant: "secondary" })} href="/app/biblioteca">
              Importar copias en la Biblioteca
            </Link>
          )}
          {blocker === "address" && hostname !== "localhost" ? (
            <a className={styles.capabilityLink} href={localUrl}>
              Abrir en localhost
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}

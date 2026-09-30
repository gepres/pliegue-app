"use client";

import { useState } from "react";

import { Button, Card, Tag, cx } from "@pliegue/ui";

import { promptInstall, useInstallKind } from "../../pwa/install-store";
import { Icon } from "../app-ui/icons";
import styles from "./install-app.module.css";

/** El botón aparece solo donde el navegador deja instalar con un clic: Chrome y Edge. */
export function InstallAppButton({
  className,
  label = "Instalar Pliegue",
  size = "md",
  variant = "secondary",
}: {
  className?: string;
  label?: string;
  size?: "lg" | "md" | "sm";
  variant?: "primary" | "quiet" | "secondary";
}) {
  const kind = useInstallKind();
  if (kind !== "available") return null;
  return (
    <Button className={className} onClick={() => void promptInstall()} size={size} variant={variant}>
      <Icon name="download" size={16} />
      {label}
    </Button>
  );
}

/** En la barra lateral de la app, con la forma de un enlace de navegación. */
export function InstallAppNavItem({
  classNames,
  collapsed,
}: {
  classNames: { icon?: string | undefined; item: string; label?: string | undefined };
  collapsed: boolean;
}) {
  const kind = useInstallKind();
  if (kind !== "available") return null;
  return (
    <button
      className={classNames.item}
      onClick={() => void promptInstall()}
      title={collapsed ? "Instalar Pliegue en este equipo" : undefined}
      type="button"
    >
      <span aria-hidden="true" className={classNames.icon}>
        <Icon name="download" size={20} />
      </span>
      <span className={classNames.label}>Instalar Pliegue</span>
    </button>
  );
}

const benefits = [
  "Su propia ventana, en el menú Inicio, el Dock o la barra de tareas",
  "Abre sin conexión: tu biblioteca y tus notas viven en este equipo",
  "Chrome recuerda el acceso a tus carpetas: no vuelve a pedir permiso cada vez",
  "Sigue usando Chrome o Edge por dentro: conserva el traductor integrado y la vinculación de carpetas",
];

/** Ajustes → Espacio de trabajo: instalar la app de escritorio, o cómo hacerlo en este navegador. */
export function InstallAppCard() {
  const kind = useInstallKind();
  const [result, setResult] = useState<string | null>(null);

  async function install() {
    const outcome = await promptInstall();
    setResult(
      outcome === "accepted"
        ? "Instalada. La encontrarás en el menú Inicio o en el escritorio."
        : outcome === "dismissed"
          ? "Instalación cancelada. Puedes volver a intentarlo cuando quieras."
          : "El navegador ya no ofrece la instalación desde aquí: usa su menú.",
    );
  }

  return (
    <Card aria-labelledby="install-title" as="section" className={styles.card}>
      <header className={styles.head}>
        <Tag>{kind === "installed" ? "Instalada" : "App de escritorio"}</Tag>
        <h2 id="install-title">Pliegue como app</h2>
        <p>
          Instálala desde Chrome o Edge y se abrirá como una aplicación más de tu ordenador, o de
          tu teléfono, sin barra de direcciones.
        </p>
      </header>

      <ul className={styles.benefits}>
        {benefits.map((benefit) => (
          <li key={benefit}>
            <Icon name="check" size={14} />
            {benefit}
          </li>
        ))}
      </ul>

      <div className={cx(styles.state)} data-kind={kind}>
        {kind === "installed" ? (
          <p>Ya la estás usando como app. Para quitarla, usa el menú ⋮ de su ventana → «Desinstalar».</p>
        ) : kind === "available" ? (
          <Button onClick={() => void install()}>
            <Icon name="download" size={18} />
            Instalar Pliegue en este equipo
          </Button>
        ) : kind === "chromium" ? (
          <p>
            Si ya la instalaste, ábrela desde el menú Inicio o el escritorio. Si no, en Chrome:
            menú ⋮ → «Enviar, guardar y compartir» → «Instalar página como app». En Edge: menú … →
            «Aplicaciones» → «Instalar este sitio como aplicación».
          </p>
        ) : kind === "ios" ? (
          <p>En Safari: botón Compartir → «Añadir a pantalla de inicio».</p>
        ) : kind === "safari" ? (
          <p>
            En Safari: menú Archivo → «Añadir al Dock». Para conservar el traductor integrado y
            la vinculación de carpetas, mejor instálala desde Chrome o Edge.
          </p>
        ) : kind === "unsupported" ? (
          <p>Este navegador no instala apps web. Ábrela en Chrome o Edge para instalarla.</p>
        ) : null}
        {result ? <p role="status">{result}</p> : null}
      </div>
    </Card>
  );
}

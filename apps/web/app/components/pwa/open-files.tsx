"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Card } from "@pliegue/ui";

import { linkFileHandles } from "../../library/local-file-reference-store";
import { PageHeader } from "../workspace-page";
import styles from "../../(workspace)/app/workspace.module.css";

/**
 * «Abrir con → Pliegue» (06.6). Con la app instalada, el sistema le pasa los archivos por la
 * `launchQueue` del manifiesto (`file_handlers`). Se vinculan como cualquier archivo suelto,
 * sin copiarlos, y uno solo se abre directamente en el lector.
 */

interface LaunchParams {
  files?: readonly FileSystemHandle[];
}

interface LaunchWindow extends Window {
  launchQueue?: { setConsumer: (consumer: (params: LaunchParams) => void) => void };
}

type OpenState =
  | { kind: "waiting" }
  | { kind: "opening"; names: string[] }
  | { kind: "nothing" }
  | { kind: "unsupported" }
  | { kind: "result"; linked: number; rejected: Array<{ name: string; reason: string }> }
  | { kind: "error"; message: string };

/** Cuánto esperar a que el sistema entregue los archivos antes de decir que no hay ninguno. */
const launchWaitMs = 1_500;

export function OpenFiles() {
  const router = useRouter();
  const [state, setState] = useState<OpenState>({ kind: "waiting" });

  useEffect(() => {
    const queue = (window as LaunchWindow).launchQueue;
    let received = false;
    const timer = window.setTimeout(() => {
      if (!received) setState(queue ? { kind: "nothing" } : { kind: "unsupported" });
    }, launchWaitMs);
    queue?.setConsumer(async (params) => {
      const handles = (params.files ?? []).filter((handle): handle is FileSystemFileHandle => handle.kind === "file");
      if (!handles.length) return;
      received = true;
      window.clearTimeout(timer);
      setState({ kind: "opening", names: handles.map((handle) => handle.name) });
      try {
        const result = await linkFileHandles(handles);
        const [only] = result.documentIds;
        if (result.documentIds.length === 1 && !result.rejected.length && only) {
          router.replace(`/app/lector?document=${encodeURIComponent(only)}`);
          return;
        }
        setState({ kind: "result", linked: result.documentIds.length, rejected: result.rejected });
      } catch (error) {
        setState({
          kind: "error",
          message: error instanceof Error ? error.message : "No se pudieron abrir los archivos.",
        });
      }
    });
    return () => window.clearTimeout(timer);
  }, [router]);

  return (
    <>
      <PageHeader
        description="Los archivos que abres con Pliegue desde el Explorador o el Finder se vinculan sin copiarlos: siguen en su carpeta."
        eyebrow="Abrir con Pliegue"
        title="Abrir archivos"
      />
      <Card className={styles.settingsCard}>
        {state.kind === "waiting" ? <p role="status">Esperando los archivos…</p> : null}
        {state.kind === "opening" ? (
          <p role="status">
            Abriendo {state.names.length === 1 ? `«${state.names[0]}»` : `${state.names.length} archivos`}…
          </p>
        ) : null}
        {state.kind === "nothing" ? (
          <p role="status">
            No hay archivos que abrir. Desde el Explorador o el Finder, usa «Abrir con → Pliegue» sobre un PDF, un EPUB o un DOCX.{" "}
            <Link href="/app/biblioteca">Ir a la Biblioteca</Link>
          </p>
        ) : null}
        {state.kind === "unsupported" ? (
          <p role="status">
            Esta página la usa Pliegue instalado como app para abrir archivos desde el Explorador o el Finder. En el
            navegador, vincula tus archivos desde la <Link href="/app/biblioteca">Biblioteca</Link>.
          </p>
        ) : null}
        {state.kind === "result" ? (
          <>
            <p role="status">
              {state.linked
                ? state.linked === 1
                  ? "Se vinculó 1 archivo: ya está en tu Biblioteca, sin copiarlo."
                  : `Se vincularon ${state.linked} archivos: ya están en tu Biblioteca, sin copiarlos.`
                : "No se pudo vincular ningún archivo."}{" "}
              <Link href="/app/biblioteca">Ir a la Biblioteca</Link>
            </p>
            {state.rejected.length ? (
              <ul>
                {state.rejected.map((file) => (
                  <li key={file.name}>
                    «{file.name}»: {file.reason}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}
        {state.kind === "error" ? (
          <p role="alert">
            {state.message} <Link href="/app/biblioteca">Ir a la Biblioteca</Link>
          </p>
        ) : null}
      </Card>
    </>
  );
}

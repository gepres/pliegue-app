"use client";

import Link from "next/link";
import { useState } from "react";

import { Button, Card, Tag, buttonClassName } from "@pliegue/ui";

import { useLinkedFiles } from "../library/local-file-reference-store";
import {
  requestLinkedFolderReadPermission,
  useLinkedFolders,
  type PermissionRequestOutcome,
} from "../library/local-folder-store";
import { useImportedDocuments } from "../library/local-library-store";
import styles from "../(workspace)/app/workspace.module.css";
import { DocumentCard, PageHeader } from "./workspace-page";

export function ReaderStart() {
  const importedLibrary = useImportedDocuments();
  const linkedFiles = useLinkedFiles();
  const linkedFolders = useLinkedFolders();
  const [requesting, setRequesting] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  /**
   * El navegador olvida el permiso de una carpeta al cerrar la pestaña. Sin este aviso, la
   * pérdida solo se descubre documento a documento —cada uno con su pantalla de reautorizar—,
   * y una biblioteca entera parece rota cuando lo único que falta es un permiso.
   */
  const blockedSources = linkedFolders.sources.filter(
    (source) => source.permission !== "granted",
  );
  const blockedDocuments = linkedFolders.documents.filter((document) =>
    blockedSources.some((source) => source.id === document.sourceId),
  ).length;

  async function grantAccess() {
    setRequesting(true);
    setPermissionError(null);

    try {
      // Se piden todas de una vez: la primera conserva la activación del usuario y las
      // siguientes suelen resolverse sin volver a preguntar.
      const outcomes: PermissionRequestOutcome[] = [];
      for (const source of blockedSources) {
        outcomes.push(await requestLinkedFolderReadPermission(source.id));
      }

      if (outcomes.includes("unanswered")) {
        setPermissionError(
          "El navegador no llegó a mostrar la ventana de permiso. Suele pasar cuando la pestaña no está en primer plano o cuando queda otra ventana de Pliegue con la petición abierta: deja visible esta pestaña, cierra las demás y vuelve a intentarlo.",
        );
      } else if (outcomes.includes("denied")) {
        setPermissionError(
          "El acceso quedó denegado. Puedes volver a concederlo desde el icono de permisos del navegador o revinculando la carpeta en la Biblioteca.",
        );
      }
    } catch {
      setPermissionError(
        "La carpeta ya no está disponible en este dispositivo. Vuelve a vincularla desde la Biblioteca.",
      );
    } finally {
      setRequesting(false);
    }
  }

  const documents = [
    ...linkedFiles.documents,
    ...linkedFolders.documents,
    ...importedLibrary.documents,
  ];
  const loading =
    importedLibrary.status === "idle" ||
    importedLibrary.status === "loading" ||
    linkedFiles.status === "idle" ||
    linkedFiles.status === "loading" ||
    linkedFolders.status === "idle" ||
    linkedFolders.status === "loading";
  const storageError = importedLibrary.error ?? linkedFiles.error ?? linkedFolders.error;

  return (
    <>
      <PageHeader
        description="Elige un archivo real de tu Biblioteca. La lectura y el progreso permanecen en este dispositivo."
        eyebrow="Lector local"
        title="¿Qué quieres leer?"
      />

      {blockedSources.length ? (
        <Card as="section" className={styles.onboardingCard} role="alert" tone="subtle">
          <Tag>Permiso requerido</Tag>
          <h2>
            Concede acceso a{" "}
            {blockedSources.map((source) => `«${source.name}»`).join(" y ")} para poder abrirlos
          </h2>
          <p>
            El navegador olvida el permiso de lectura al cerrar o recargar la pestaña, así que
            ahora mismo {blockedDocuments} documento{blockedDocuments === 1 ? "" : "s"} no se
            {blockedDocuments === 1 ? " puede" : " pueden"} abrir. Con una sola autorización
            vuelven a estar disponibles todos; si no la das aquí, cada documento la pedirá por
            separado. Tus archivos no se copian ni se envían a ningún sitio.
          </p>
          <Button disabled={requesting} onClick={() => void grantAccess()}>
            {requesting ? "Solicitando acceso…" : "Conceder acceso"}
          </Button>
          {permissionError ? (
            <p aria-live="polite" role="status">
              {permissionError}
            </p>
          ) : null}
        </Card>
      ) : null}

      {documents.length ? (
        <section aria-label="Documentos disponibles" className={styles.documentGrid}>
          {documents.slice(0, 6).map((document) => (
            <DocumentCard
              eyebrow={`${document.format.toUpperCase()} · Local`}
              key={document.id}
              title={document.title}
            >
              <p>{document.meta}</p>
              <div className={styles.documentMeta}>
                <Tag>
                  {document.availability === "available" ? "Disponible" : "En este dispositivo"}
                </Tag>
                <Link
                  className={buttonClassName({ size: "sm", variant: "secondary" })}
                  href={{ pathname: "/app/lector", query: { document: document.id } }}
                >
                  Abrir
                </Link>
              </div>
            </DocumentCard>
          ))}
        </section>
      ) : loading ? (
        <Card aria-live="polite" className={styles.emptyState} role="status" tone="subtle">
          <Tag>Preparando</Tag>
          <h2>Recuperando tu Biblioteca…</h2>
        </Card>
      ) : storageError ? (
        <Card className={styles.emptyState} role="alert" tone="subtle">
          <Tag>Almacenamiento no disponible</Tag>
          <h2>No pudimos abrir tu Biblioteca local</h2>
          <p>{storageError}</p>
        </Card>
      ) : (
        <Card as="section" className={styles.onboardingCard} tone="subtle">
          <Tag>Sin documentos</Tag>
          <h2>Primero añade un archivo a tu Biblioteca</h2>
          <p>
            El lector ya no muestra contenido de demostración. Vincula un archivo o carpeta
            para analizarlo sin duplicar el binario y abrirlo desde su ubicación original.
          </p>
          <Link className={buttonClassName()} href="/app/biblioteca#importar-archivos">
            Ir a vincular archivos
          </Link>
        </Card>
      )}
    </>
  );
}

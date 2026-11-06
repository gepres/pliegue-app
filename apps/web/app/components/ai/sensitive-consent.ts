"use client";

import type { LibraryDocument } from "../../library/documents";
import { flowNames, type SensitiveFlow } from "../../library/sensitivity";
import { grantConsent } from "../../library/sensitivity-store";
import { confirmAction } from "../app-ui/confirm-dialog";

const what: Record<SensitiveFlow, string> = {
  catalog: "un extracto del principio",
  translate: "el texto de cada página o sección que se traduce",
};

/**
 * Libros personales que van a salir del equipo (04.3): se pregunta una vez por libro y flujo, y
 * la respuesta «sí» se recuerda. Devuelve si se aceptó.
 */
export async function confirmPersonalSend(
  documents: ReadonlyArray<Pick<LibraryDocument, "id" | "title">>,
  flow: SensitiveFlow,
  provider: string,
) {
  if (!documents.length) return true;
  const many = documents.length > 1;
  const shown = documents.slice(0, 5).map((document) => document.title);
  const accepted = await confirmAction({
    cancelLabel: many ? "Saltarlos" : "Ahora no",
    confirmLabel: many ? "Enviarlos también" : "Enviar",
    description: many
      ? `${documents.length} libros que vas a ${flowNames[flow]} están marcados como personales. Para ${flowNames[flow]}los se envía a ${provider} ${what[flow]}.`
      : `«${documents[0]?.title}» está marcado como personal. Para ${flowNames[flow]}lo se envía a ${provider} ${what[flow]}.`,
    details: many ? [...shown, ...(documents.length > shown.length ? [`y ${documents.length - shown.length} más`] : [])] : [],
    icon: "cloud",
    note: "Se recuerda para este libro: no se vuelve a preguntar. Los confidenciales nunca salen del equipo. La sensibilidad se cambia en el menú del libro o en Ajustes → Fuentes.",
    title: many ? `¿${flowNames[flow][0]?.toUpperCase()}${flowNames[flow].slice(1)} también los libros personales?` : `¿Enviar un libro personal a ${provider}?`,
  });
  if (accepted) grantConsent(documents.map((document) => document.id), flow);
  return accepted;
}

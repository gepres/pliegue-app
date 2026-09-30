"use client";

import { confirmAction } from "../components/app-ui/confirm-dialog";

/**
 * Antes de un permiso de archivos del navegador, un aviso de la app.
 *
 * «¿Permitir que este sitio vea archivos?» es una ventana de seguridad de Chrome: ninguna web
 * puede sustituirla ni cambiar su texto, y bien está. Lo que sí puede hacer la app es anunciarla
 * —qué va a salir, qué botón conviene y que es solo lectura— para que no llegue por sorpresa.
 * Se explica la primera vez de cada tipo; después, el permiso se pide directamente.
 *
 * Desde Chrome 122, al volver a pedirlo ofrece «Permitir en cada visita», y una app instalada
 * conserva el permiso sin preguntar:
 * https://developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api
 */
export type FilePermissionKind = "pick-folder" | "regrant";

const storageKey = "pliegue-aviso-permisos-v1";

function explained(kind: FilePermissionKind) {
  try {
    const seen = JSON.parse(window.localStorage.getItem(storageKey) ?? "[]") as string[];
    return seen.includes(kind);
  } catch {
    return false;
  }
}

function remember(kind: FilePermissionKind) {
  try {
    const seen = JSON.parse(window.localStorage.getItem(storageKey) ?? "[]") as string[];
    window.localStorage.setItem(storageKey, JSON.stringify([...new Set([...seen, kind])]));
  } catch {
    // Sin almacenamiento se volverá a explicar; no pasa nada.
  }
}

function installed() {
  return window.matchMedia("(display-mode: standalone)").matches;
}

/**
 * `true` si hay que seguir y pedir el permiso. Se llama desde el clic de la persona: el
 * «Continuar» del modal es a su vez un gesto, así que el navegador sigue aceptando la petición.
 */
export async function beforeFilePermission(kind: FilePermissionKind): Promise<boolean> {
  if (explained(kind)) return true;
  const confirmed = await confirmAction(
    kind === "pick-folder"
      ? {
          cancelLabel: "Ahora no",
          confirmLabel: "Elegir la carpeta",
          description:
            "Al elegirla, Chrome te preguntará si Pliegue puede ver sus archivos. Es una ventana del navegador, no de la app: pulsa «Ver archivos» o «Permitir».",
          details: [
            "Es solo lectura: Pliegue abre cada archivo para indexarlo.",
            "No los copia, no los cambia y no los sube a ninguna parte.",
          ],
          icon: "folder",
          note: installed()
            ? "Como tienes Pliegue instalada, Chrome recordará el permiso."
            : "Si instalas Pliegue como app, Chrome recordará el permiso y no volverá a preguntar.",
          title: "Chrome te pedirá permiso",
        }
      : {
          cancelLabel: "Ahora no",
          confirmLabel: "Continuar",
          description:
            "Por seguridad, Chrome olvida el acceso a tus carpetas al cerrar la pestaña, y ahora te lo volverá a pedir en una ventana suya.",
          details: [
            "Elige «Permitir en cada visita» si aparece: así no volverá a preguntar.",
            "Es solo lectura: Pliegue no copia ni cambia tus archivos.",
          ],
          icon: "folder",
          note: installed()
            ? "Con Pliegue instalada, Chrome suele conservar el permiso sin preguntar."
            : "Si instalas Pliegue como app, Chrome conserva el permiso sin preguntar.",
          title: "Chrome volverá a pedir acceso",
        },
  );
  if (confirmed) remember(kind);
  return confirmed;
}

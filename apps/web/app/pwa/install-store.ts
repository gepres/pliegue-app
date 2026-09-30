"use client";

import { useSyncExternalStore } from "react";

/** El evento de Chrome y Edge que permite ofrecer la instalación desde la propia app. */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

declare global {
  interface Window {
    /** Lo guarda un script temprano del layout: el evento puede llegar antes de hidratar. */
    __pliegueInstallPrompt?: BeforeInstallPromptEvent | null;
  }
}

/**
 * Cómo se puede instalar Pliegue en este navegador:
 * - `installed`: ya se está usando como app (ventana propia);
 * - `available`: Chrome o Edge ofrecen instalarla con un botón;
 * - `chromium`: Chrome o Edge sin aviso —ya instalada y abierta en una pestaña, o aún
 *   evaluándola—: se explica cómo hacerlo desde su menú;
 * - `ios`, `safari`: se instala desde el menú de compartir o el de archivo;
 * - `unsupported`: Firefox y otros; se recomienda Chrome o Edge.
 */
export type InstallKind = "available" | "chromium" | "installed" | "ios" | "safari" | "unsupported" | "unknown";

let kind: InstallKind = "unknown";
let started = false;
const listeners = new Set<() => void>();

function emit(next: InstallKind) {
  kind = next;
  for (const listener of listeners) listener();
}

function standalone() {
  const navigatorWithStandalone = window.navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: window-controls-overlay)").matches ||
    navigatorWithStandalone.standalone === true
  );
}

function detect(): InstallKind {
  if (standalone()) return "installed";
  if (window.__pliegueInstallPrompt) return "available";
  const agent = window.navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(agent) || (/Macintosh/.test(agent) && window.navigator.maxTouchPoints > 1);
  if (ios) return "ios";
  if (/Chrome|Chromium|Edg\//.test(agent)) return "chromium";
  if (/Safari/.test(agent)) return "safari";
  return "unsupported";
}

function start() {
  if (started) return;
  started = true;
  emit(detect());
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    window.__pliegueInstallPrompt = event as BeforeInstallPromptEvent;
    if (kind !== "installed") emit("available");
  });
  window.addEventListener("appinstalled", () => {
    window.__pliegueInstallPrompt = null;
    emit("installed");
  });
  window.matchMedia("(display-mode: standalone)").addEventListener("change", () => emit(detect()));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  start();
  return () => listeners.delete(listener);
}

export function useInstallKind() {
  return useSyncExternalStore(subscribe, () => kind, () => "unknown" as InstallKind);
}

/** Abre el diálogo de instalación del navegador. Solo sirve una vez por aviso. */
export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const event = window.__pliegueInstallPrompt;
  if (!event) return "unavailable";
  window.__pliegueInstallPrompt = null;
  await event.prompt();
  const { outcome } = await event.userChoice;
  if (outcome === "dismissed") emit(detect());
  return outcome;
}

/** Script para el `<head>`: guarda el aviso aunque llegue antes de que React arranque. */
export const earlyInstallCapture = `window.addEventListener("beforeinstallprompt",function(e){e.preventDefault();window.__pliegueInstallPrompt=e;});`;

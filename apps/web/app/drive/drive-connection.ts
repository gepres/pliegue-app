"use client";

import { useSyncExternalStore } from "react";

import { publicConfig } from "../config/public-config";
import { getDriveUser } from "./drive-api";
import { loadGoogleIdentity, type GoogleTokenResponse } from "./google-scripts";

/** Solo los archivos que la persona elige en el selector de Google. No requiere verificación. */
export const driveFileScope = "https://www.googleapis.com/auth/drive.file";
/** Leer una carpeta completa. Google lo clasifica como restringido: se pide solo al vincular una. */
export const driveReadonlyScope = "https://www.googleapis.com/auth/drive.readonly";

/**
 * - `granted`: hay token con los permisos pedidos.
 * - `cancelled`: la persona cerró la ventana de Google o no marcó el permiso.
 * - `blocked`: la ventana no llegó a abrirse (bloqueador de ventanas o sin gesto del usuario).
 */
export type DriveAccessOutcome = "blocked" | "cancelled" | "granted";

export interface DriveConnectionSnapshot {
  /** Autorizó Drive en este navegador y no lo ha desconectado: puede reconectar con un clic. */
  authorized: boolean;
  configured: boolean;
  email: string | null;
  error: string | null;
  /** Concedió leer carpetas completas (`drive.readonly`). */
  readonly: boolean;
  status: "connecting" | "idle";
  /** Hay un token vigente en esta pestaña. */
  tokenReady: boolean;
}

interface StoredHints {
  authorized: boolean;
  email: string | null;
  readonly: boolean;
}

// Lo que se recuerda entre visitas no es secreto: si autorizó, con qué cuenta y qué alcance.
// El token vive solo en memoria (gate 3 de ADR-0002): al recargar, un clic lo renueva.
const hintsKey = "pliegue-drive-v1";
const expiryMarginMs = 60_000;

let token: { expiresAt: number; value: string } | null = null;
let expiryTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

const serverSnapshot: DriveConnectionSnapshot = {
  authorized: false,
  configured: false,
  email: null,
  error: null,
  readonly: false,
  status: "idle",
  tokenReady: false,
};

function readHints(): StoredHints {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(hintsKey) ?? "null") as Partial<StoredHints> | null;
    return {
      authorized: parsed?.authorized === true,
      email: typeof parsed?.email === "string" ? parsed.email : null,
      readonly: parsed?.readonly === true,
    };
  } catch {
    return { authorized: false, email: null, readonly: false };
  }
}

function writeHints(hints: StoredHints | null) {
  try {
    if (hints) window.localStorage.setItem(hintsKey, JSON.stringify(hints));
    else window.localStorage.removeItem(hintsKey);
  } catch {
    // Sin almacenamiento solo se pierde el recordatorio: la conexión funciona igual.
  }
}

let snapshot: DriveConnectionSnapshot | null = null;

function buildSnapshot(patch: Partial<DriveConnectionSnapshot> = {}): DriveConnectionSnapshot {
  const hints = readHints();
  return {
    authorized: hints.authorized,
    configured: Boolean(publicConfig.drive),
    email: hints.email,
    error: null,
    readonly: hints.readonly,
    status: "idle",
    tokenReady: getDriveToken() !== null,
    ...patch,
  };
}

function emit(patch: Partial<DriveConnectionSnapshot> = {}) {
  snapshot = buildSnapshot(patch);
  for (const listener of listeners) listener();
}

export function subscribeDriveConnection(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  snapshot ??= buildSnapshot();
  return snapshot;
}

export function useDriveConnection() {
  return useSyncExternalStore(subscribeDriveConnection, getSnapshot, () => serverSnapshot);
}

export function readDriveConnection() {
  return getSnapshot();
}

/** El token vigente, o `null` si no hay o está a punto de caducar. */
export function getDriveToken() {
  if (!token || token.expiresAt - expiryMarginMs <= Date.now()) return null;
  return token.value;
}

/**
 * Carga Google Identity Services de antemano. La ventana de Google solo se abre si la petición
 * sale de un clic reciente: si el clic tuviera que esperar a descargar la biblioteca, el
 * navegador podría bloquearla.
 */
export function preloadDriveConnection() {
  if (!publicConfig.drive) return;
  void loadGoogleIdentity().catch(() => undefined);
}

/**
 * Pide acceso a Drive. Llamar desde un clic. `readonly` añade el permiso de carpeta completa;
 * una vez concedido, las reconexiones lo piden siempre para no perderlo.
 */
export async function connectDrive(options: { readonly?: boolean; selectAccount?: boolean } = {}): Promise<DriveAccessOutcome> {
  const config = publicConfig.drive;
  if (!config) throw new Error("Esta instalación de Pliegue no tiene Google Drive configurado.");

  const hints = readHints();
  const wantsReadonly = options.readonly === true || hints.readonly;
  const scopes = wantsReadonly ? [driveFileScope, driveReadonlyScope] : [driveFileScope];
  emit({ status: "connecting" });

  let oauth2;
  try {
    oauth2 = await loadGoogleIdentity();
  } catch (error) {
    emit({ error: error instanceof Error ? error.message : String(error) });
    throw error;
  }

  const response = await new Promise<GoogleTokenResponse | { popup: "blocked" | "closed" }>((resolve) => {
    const client = oauth2.initTokenClient({
      callback: (tokenResponse) => resolve(tokenResponse),
      client_id: config.clientId,
      error_callback: (error) => resolve({ popup: error.type === "popup_failed_to_open" ? "blocked" : "closed" }),
      // Los permisos ya concedidos a Pliegue vienen también en el token nuevo.
      include_granted_scopes: true,
      scope: scopes.join(" "),
    });
    client.requestAccessToken({
      ...(hints.email && !options.selectAccount ? { login_hint: hints.email } : {}),
      prompt: options.selectAccount ? "select_account" : "",
    });
  });

  if ("popup" in response) {
    emit({ error: response.popup === "blocked" ? "El navegador no dejó abrir la ventana de Google." : null });
    return response.popup === "blocked" ? "blocked" : "cancelled";
  }
  if (response.error || !response.access_token) {
    emit({ error: response.error === "access_denied" ? null : (response.error_description ?? response.error ?? null) });
    return "cancelled";
  }

  const readonlyGranted = oauth2.hasGrantedAllScopes(response, driveReadonlyScope);
  const fileGranted = readonlyGranted || oauth2.hasGrantedAllScopes(response, driveFileScope);
  // Con el consentimiento granular, la persona puede desmarcar la casilla de Drive.
  if (!fileGranted || (options.readonly && !readonlyGranted)) {
    emit({
      error: options.readonly
        ? "Para vincular una carpeta completa hay que marcar la casilla de ver los archivos de Drive."
        : "Para elegir libros de Drive hay que marcar la casilla de acceso a Drive.",
    });
    return "cancelled";
  }

  const expiresIn = Number(response.expires_in ?? 3600);
  token = { expiresAt: Date.now() + (Number.isFinite(expiresIn) ? expiresIn : 3600) * 1000, value: response.access_token };
  if (expiryTimer) clearTimeout(expiryTimer);
  expiryTimer = setTimeout(() => emit(), Math.max(0, token.expiresAt - expiryMarginMs - Date.now()));
  writeHints({ authorized: true, email: hints.email, readonly: readonlyGranted });
  emit();

  // La cuenta solo sirve para mostrarla y como pista al reconectar: no bloquea la conexión.
  void getDriveUser(response.access_token)
    .then((user) => {
      writeHints({ ...readHints(), email: user.email });
      emit();
    })
    .catch(() => undefined);
  return "granted";
}

/** Revoca el acceso en Google y olvida la cuenta. Los documentos quedan, sin poder abrirse. */
export async function disconnectDrive() {
  const current = token?.value ?? null;
  token = null;
  if (expiryTimer) clearTimeout(expiryTimer);
  writeHints(null);
  emit();
  if (!current) return { revoked: false };
  try {
    const oauth2 = await loadGoogleIdentity();
    await new Promise<void>((resolve) => oauth2.revoke(current, () => resolve()));
    return { revoked: true };
  } catch {
    return { revoked: false };
  }
}

/** Solo para pruebas: deja el módulo como recién cargado. */
export function resetDriveConnectionForTests() {
  token = null;
  snapshot = null;
}

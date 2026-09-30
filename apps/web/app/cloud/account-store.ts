"use client";

import { useSyncExternalStore } from "react";

import type { AuthError, Session } from "@supabase/supabase-js";

import { publicConfig } from "../config/public-config";
import { cloudClient, cloudConfigured } from "./supabase-client";

/**
 * La cuenta de Pliegue, opcional. Sin sesión todo sigue en este dispositivo, como siempre; con
 * ella, lo que la persona elija se sincroniza entre sus equipos.
 */
export interface AccountState {
  email: string | null;
  /** El enlace del correo o la vuelta de Google fallaron: caducado, otro navegador… */
  linkError: string | null;
  provider: string | null;
  status: "loading" | "signed-in" | "signed-out" | "unavailable";
  userId: string | null;
}

const unavailable: AccountState = { email: null, linkError: null, provider: null, status: "unavailable", userId: null };
const loading: AccountState = { email: null, linkError: null, provider: null, status: "loading", userId: null };

let state: AccountState = cloudConfigured ? loading : unavailable;
let started = false;
const listeners = new Set<() => void>();

function emit(next: AccountState) {
  state = next;
  for (const listener of listeners) listener();
}

function fromSession(session: Session | null): AccountState {
  if (!session) return { email: null, linkError: state.linkError, provider: null, status: "signed-out", userId: null };
  const provider = session.user.app_metadata?.provider;
  return {
    email: session.user.email ?? null,
    linkError: null,
    provider: typeof provider === "string" ? provider : null,
    status: "signed-in",
    userId: session.user.id,
  };
}

/** Quita de la URL el `?code=` de la vuelta de Google o del correo, ya canjeado. */
function cleanAuthParams() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("code") && !url.searchParams.has("error_description")) return;
  url.searchParams.delete("code");
  url.searchParams.delete("error");
  url.searchParams.delete("error_code");
  url.searchParams.delete("error_description");
  window.history.replaceState(window.history.state, "", url);
}

function start() {
  if (started) return;
  started = true;
  const client = cloudClient();
  if (!client) {
    emit(unavailable);
    return;
  }
  // Un enlace caducado vuelve con el motivo en la URL (en la consulta o, a veces, en el hash).
  const url = new URL(window.location.href);
  const hash = new URLSearchParams(url.hash.replace(/^#/, "").replace(/^[^?]*\?/, ""));
  const returned = url.searchParams.get("error_description") ?? hash.get("error_description");
  if (returned) state = { ...state, linkError: describeAuthError(new Error(returned)) };

  client.auth.onAuthStateChange((_event, session) => {
    emit(fromSession(session));
    if (session) cleanAuthParams();
  });
  // `initialize` es el que canjea el `?code=` del enlace o de Google: si falla, dice por qué.
  const hadCode = url.searchParams.has("code");
  void client.auth.initialize().then(async ({ error }) => {
    if (error) state = { ...state, linkError: describeAuthError(error) };
    const { data } = await client.auth.getSession();
    // Sin su verificador PKCE —el enlace se abrió en otro navegador—, supabase-js ignora el
    // código sin decir nada: la persona vería el formulario sin saber por qué.
    if (hadCode && !data.session && !error) {
      state = { ...state, linkError: "Abre el enlace en el mismo navegador donde lo pediste, o pide un correo nuevo." };
    }
    emit(fromSession(data.session));
    cleanAuthParams();
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  start();
  return () => listeners.delete(listener);
}

export function useAccount() {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => (cloudConfigured ? loading : unavailable),
  );
}

export function currentAccount() {
  return state;
}

/** El mensaje de Supabase, dicho para una persona y en español. */
export function describeAuthError(error: AuthError | Error | null | undefined) {
  if (!error) return "No fue posible completar el inicio de sesión.";
  const code = "code" in error && typeof error.code === "string" ? error.code : "";
  const message = error.message ?? "";
  if (code === "over_email_send_rate_limit" || /rate limit|only request this after/i.test(message)) {
    return "Se pidieron demasiados correos seguidos. Espera un minuto y vuelve a intentarlo.";
  }
  if (/code verifier|flow state|flow_state/i.test(message) || code === "flow_state_not_found") {
    return "Abre el enlace en el mismo navegador donde lo pediste, o pide un correo nuevo.";
  }
  if (code === "otp_expired" || /expired|invalid/i.test(message)) {
    return "El enlace o el código no es válido o ya caducó. Pide uno nuevo.";
  }
  if (code === "email_address_invalid" || /invalid.*email|email.*invalid/i.test(message)) {
    return "Esa dirección de correo no parece válida.";
  }
  if (/provider is not enabled|unsupported provider/i.test(message)) {
    return "El acceso con Google aún no está activado en el proyecto de Supabase.";
  }
  if (/fetch|network/i.test(message)) return "Sin conexión con el servidor. Revisa tu red.";
  return message || "No fue posible completar el inicio de sesión.";
}

function returnUrl() {
  return `${window.location.origin}/app/ajustes#cuenta`;
}

/** Envía un código de un solo uso al correo. Si la cuenta no existe, se crea. */
export async function requestEmailCode(email: string) {
  const client = cloudClient();
  if (!client) throw new Error("La cuenta no está disponible en esta instalación.");
  const { error } = await client.auth.signInWithOtp({
    email: email.trim(),
    options: { emailRedirectTo: returnUrl(), shouldCreateUser: true },
  });
  if (error) throw new Error(describeAuthError(error));
}

/**
 * Entra con el código del correo. Se usa el código y no solo el enlace: una app instalada abre
 * los enlaces en el navegador, no en su ventana, y ahí no estaría la sesión.
 */
export async function verifyEmailCode(email: string, code: string) {
  const client = cloudClient();
  if (!client) throw new Error("La cuenta no está disponible en esta instalación.");
  const { error } = await client.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
  if (error) throw new Error(describeAuthError(error));
}

/**
 * ¿Está activado ese proveedor en el proyecto? Se pregunta antes de salir hacia él: si no lo
 * está, Supabase respondería con una página de error en JSON en lugar de volver a la app.
 */
async function providerEnabled(provider: "google") {
  const cloud = publicConfig.cloud;
  if (!cloud) return false;
  try {
    const response = await fetch(`${cloud.url}/auth/v1/settings`, { headers: { apikey: cloud.publishableKey } });
    const settings = (await response.json()) as { external?: Record<string, boolean> };
    return settings.external?.[provider] !== false;
  } catch {
    // Sin respuesta no se sabe: se intenta, y el error llegará de Google o de Supabase.
    return true;
  }
}

export async function signInWithGoogle() {
  const client = cloudClient();
  if (!client) throw new Error("La cuenta no está disponible en esta instalación.");
  if (!(await providerEnabled("google"))) {
    throw new Error("El acceso con Google aún no está activado en el proyecto. Mientras tanto, entra con tu correo.");
  }
  const { error } = await client.auth.signInWithOAuth({
    options: { redirectTo: returnUrl() },
    provider: "google",
  });
  if (error) throw new Error(describeAuthError(error));
}

/** Cierra la sesión en este equipo; los demás siguen dentro y los datos locales se quedan. */
export async function signOut() {
  const client = cloudClient();
  if (!client) return;
  await client.auth.signOut({ scope: "local" });
}

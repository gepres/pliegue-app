"use client";

import { useEffect } from "react";

import { cloudConfigured } from "./supabase-client";

/**
 * Si Supabase devuelve a la persona a otra página —la Site URL, casi siempre la portada, cuando
 * la dirección de vuelta no está en la lista permitida—, el `?code=` del enlace o de Google se
 * quedaría ahí sin canjear: la portada no arranca la sesión. Se la lleva a Ajustes → Cuenta con
 * sus parámetros, que es donde se completa la entrada.
 */
export function AuthReturn() {
  useEffect(() => {
    if (!cloudConfigured || window.location.pathname.startsWith("/app")) return;
    const url = new URL(window.location.href);
    const returning =
      url.searchParams.has("code") ||
      url.searchParams.has("error_description") ||
      url.hash.includes("error_description");
    if (returning) window.location.replace(`/app/ajustes${url.search}#cuenta`);
  }, []);
  return null;
}

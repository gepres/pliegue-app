"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { publicConfig } from "../config/public-config";

let client: SupabaseClient | null = null;

/** ¿Hay nube en esta instalación? Sin ella, Pliegue es solo local y la cuenta no aparece. */
export const cloudConfigured = publicConfig.cloud !== null;

/**
 * El cliente de Supabase, creado al primer uso en el navegador; `null` sin nube o en el
 * servidor. La sesión se guarda en `localStorage` con su propia clave: son los tokens de la
 * cuenta de Pliegue, no las claves de los proveedores de IA, que nunca se guardan.
 *
 * `pkce`: al volver de Google o de un enlace del correo llega un `?code=` que el propio cliente
 * cambia por la sesión (`detectSessionInUrl`), sin que los tokens pasen por la URL.
 */
export function cloudClient(): SupabaseClient | null {
  if (client) return client;
  const cloud = publicConfig.cloud;
  if (!cloud || typeof window === "undefined") return null;
  client = createClient(cloud.url, cloud.publishableKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: "pkce",
      persistSession: true,
      storageKey: "pliegue-auth",
    },
  });
  return client;
}

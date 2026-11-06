"use client";

/**
 * Un identificador al azar de este navegador, que no dice nada de la persona. Lo usan la
 * sincronización (quién escribió cada fila) y el gasto de IA (el contador de cada equipo).
 */
export function deviceId() {
  const key = "pliegue-device-id";
  try {
    const existing = window.localStorage.getItem(key);
    if (existing) return existing;
    const created = crypto.randomUUID();
    window.localStorage.setItem(key, created);
    return created;
  } catch {
    return "sin-almacenamiento";
  }
}

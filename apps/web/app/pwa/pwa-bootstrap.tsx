"use client";

import { useEffect } from "react";

/**
 * Registra el service worker en producción. En desarrollo no: cachearía las páginas y el
 * recargado en caliente dejaría de verse. Si quedó uno de una prueba en producción en este
 * mismo origen, se da de baja para que no sirva páginas viejas mientras se desarrolla.
 */
export function PwaBootstrap() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const registration of registrations) void registration.unregister();
      });
      return;
    }
    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // Sin service worker la app funciona igual; solo no abre sin conexión.
    });
  }, []);
  return null;
}

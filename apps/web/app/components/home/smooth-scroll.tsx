"use client";

import { useEffect } from "react";

import "lenis/dist/lenis.css";

/**
 * Desplazamiento suave con inercia en la portada (Lenis), como el de las webs editoriales.
 *
 * Solo con ratón o trackpad: en una pantalla táctil el desplazamiento nativo ya tiene su inercia
 * y cualquier imitación se nota. Y nunca con «reducir movimiento». La biblioteca se pide después
 * de pintar la página, así que no retrasa lo primero que se ve; los efectos ligados al
 * desplazamiento son CSS y no dependen de ella.
 */
export function SmoothScroll() {
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const finePointer = window.matchMedia("(pointer: fine)").matches;
    if (reduced || !finePointer) return;

    let cancelled = false;
    let destroy: (() => void) | null = null;

    void import("lenis").then(({ default: Lenis }) => {
      if (cancelled) return;
      const lenis = new Lenis({
        // Los enlaces del índice y del pie llevan a su capítulo con suavidad. Lenis respeta el
        // `scroll-margin-top` de cada capítulo, el mismo que usa el navegador sin Lenis: con un
        // desplazamiento propio encima, el capítulo caía 76 px más abajo de la cuenta.
        anchors: true,
        autoRaf: true,
        // Un punto más ágil que el de serie (0,1): suave, pero sin que la página parezca pesada.
        lerp: 0.12,
        stopInertiaOnNavigate: true,
      });
      destroy = () => lenis.destroy();
    });

    return () => {
      cancelled = true;
      destroy?.();
    };
  }, []);

  return null;
}

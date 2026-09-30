"use client";

import { useSyncExternalStore } from "react";

/**
 * Qué se ve mientras se traduce: la traducción en lugar del original, las dos en paralelo o
 * solo el original. «En paralelo» es cosa de pantallas anchas: en un teléfono, dos columnas de
 * la mitad de ancho no se leen.
 */
export type TranslationView = "translated" | "parallel" | "original";

/** Cómo se enseña la traducción cuando se enseña: encima del original o a su lado. */
export type TranslationLayout = "overlay" | "parallel";

const layoutKey = "pliegue-translation-layout";

/** La forma elegida la última vez, en este dispositivo y para todos los libros. */
export function readTranslationLayout(): TranslationLayout {
  if (typeof window === "undefined") return "overlay";
  try {
    return window.localStorage.getItem(layoutKey) === "parallel" ? "parallel" : "overlay";
  } catch {
    return "overlay";
  }
}

export function writeTranslationLayout(layout: TranslationLayout) {
  try {
    window.localStorage.setItem(layoutKey, layout);
  } catch {
    // Sin almacenamiento se elige igual; solo que no se recuerda.
  }
}

/** Desde este ancho caben el original y la traducción uno al lado del otro. */
const parallelWidthQuery = "(min-width: 1100px)";

function subscribeToParallelWidth(onChange: () => void) {
  const query = window.matchMedia(parallelWidthQuery);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export function useParallelWidth() {
  return useSyncExternalStore(
    subscribeToParallelWidth,
    () => window.matchMedia(parallelWidthQuery).matches,
    () => false,
  );
}

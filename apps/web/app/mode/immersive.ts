"use client";

import { useEffect } from "react";

/**
 * Modo inmersivo: mientras un documento está abierto, el marco de la aplicación —barra
 * lateral, barra superior, pestañas inferiores— se retira y el lector trae su propia barra.
 *
 * Es lo que hacen los lectores nativos: la biblioteca es un sitio y el libro abierto es
 * otro. Se marca en `<html>` y no con estado de React porque el marco vive en el layout y el
 * lector en la página: un atributo en la raíz lo leen los dos sin atravesar el árbol ni
 * obligar al layout a depender de los parámetros de búsqueda.
 */
export function useImmersiveMode(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    root.dataset.immersive = "true";
    return () => {
      delete root.dataset.immersive;
    };
  }, [active]);
}

import type { Metadata } from "next";
import { Suspense } from "react";

import { SkeletonGroup, SkeletonPage } from "../../../components/app-ui/skeleton";
import { ReaderRoute } from "../../../components/reader/reader-route";

export const metadata: Metadata = {
  title: "Lector",
  description: "Superficie de lectura de Pliegue con progreso y notas.",
};

/**
 * El lector. Qué libro abrir (`document`), si se retoma (`resume`) y qué fragmento de una
 * búsqueda enseñar (`fragmento`) se leen en el navegador (`ReaderRoute`): la página es la misma
 * para todos los libros y así abre también sin conexión desde la caché del service worker.
 */
export default function ReaderPage() {
  return (
    <Suspense
      fallback={
        <SkeletonGroup label="Preparando el lector">
          <SkeletonPage />
        </SkeletonGroup>
      }
    >
      <ReaderRoute />
    </Suspense>
  );
}

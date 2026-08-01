import type { Metadata } from "next";

import { Card } from "@pliegue/ui";

import { LibraryBrowser } from "../../../components/library-browser";
import { PageHeader } from "../../../components/workspace-page";
import styles from "../workspace.module.css";

export const metadata: Metadata = {
  title: "Biblioteca",
  description: "Documentos de Drive y archivos locales reunidos en Pliegue.",
};

export default function LibraryPage() {
  return (
    <>
      <PageHeader
        description="Busca en todo el espacio o filtra por procedencia, formato y disponibilidad."
        eyebrow="Biblioteca local"
        title="Biblioteca"
      />

      <LibraryBrowser />

      <Card as="section" className={styles.section} tone="subtle">
        <strong>Datos de demostración locales.</strong> La búsqueda, los filtros y los
        favoritos ya funcionan; Drive se conectará únicamente después de completar OAuth.
      </Card>
    </>
  );
}

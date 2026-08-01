import type { Metadata } from "next";

import { LibraryBrowser } from "../../../components/library-browser";
import { PageHeader } from "../../../components/workspace-page";

export const metadata: Metadata = {
  title: "Biblioteca",
  description: "Documentos de Drive y archivos locales reunidos en Pliegue.",
};

export default function LibraryPage() {
  return (
    <>
      <PageHeader
        description="Importa archivos o vincula carpetas y busca únicamente entre los documentos reales de este navegador."
        eyebrow="Biblioteca local"
        title="Biblioteca"
      />

      <LibraryBrowser />
    </>
  );
}

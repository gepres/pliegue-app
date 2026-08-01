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
        description="Vincula archivos o carpetas sin duplicarlos y busca en el índice local de este navegador."
        eyebrow="Biblioteca local"
        title="Biblioteca"
      />

      <LibraryBrowser />
    </>
  );
}

import type { Metadata } from "next";

import { OpenFiles } from "../../../components/pwa/open-files";

export const metadata: Metadata = {
  description: "Abre en Pliegue los PDF, EPUB y DOCX que eliges en el Explorador o el Finder.",
  robots: { follow: false, index: false },
  title: "Abrir archivos",
};

/** Destino de los `file_handlers` del manifiesto: «Abrir con → Pliegue» en la app instalada. */
export default function OpenFilesPage() {
  return <OpenFiles />;
}

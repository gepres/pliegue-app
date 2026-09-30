import type { Metadata } from "next";

import { LibraryBrowser } from "../../../components/library-browser";

export const metadata: Metadata = {
  title: "Biblioteca",
  description: "Documentos de Drive y archivos locales reunidos en Pliegue.",
};

export default function LibraryPage() {
  // La cabecera vive dentro del explorador: sus acciones —Fuentes, Añadir— necesitan el
  // estado de la Biblioteca, y separarlas obligaría a levantarlo hasta la página.
  return <LibraryBrowser />;
}

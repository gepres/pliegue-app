import type { Metadata } from "next";

import { LocalDocumentReader } from "../../../components/local-document-reader";
import { ReaderStart } from "../../../components/reader-start";

export const metadata: Metadata = {
  title: "Lector",
  description: "Superficie de lectura de Pliegue con progreso y notas.",
};

interface ReaderPageProps {
  searchParams: Promise<{
    document?: string | string[];
    /** Un fragmento de la búsqueda (04.4): el libro se abre en su página o su bloque. */
    fragmento?: string | string[];
    resume?: string | string[];
  }>;
}

export default async function ReaderPage({ searchParams }: ReaderPageProps) {
  const parameters = await searchParams;
  const documentId = Array.isArray(parameters.document)
    ? parameters.document[0]
    : parameters.document;
  const resume = Array.isArray(parameters.resume) ? parameters.resume[0] : parameters.resume;
  const fragmentId = Array.isArray(parameters.fragmento) ? parameters.fragmento[0] : parameters.fragmento;

  if (documentId) {
    return <LocalDocumentReader documentId={documentId} fragmentId={fragmentId} resumeRequested={resume === "1"} />;
  }

  return <ReaderStart />;
}

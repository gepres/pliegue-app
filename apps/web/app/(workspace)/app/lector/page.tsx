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
    resume?: string | string[];
  }>;
}

export default async function ReaderPage({ searchParams }: ReaderPageProps) {
  const parameters = await searchParams;
  const documentId = Array.isArray(parameters.document)
    ? parameters.document[0]
    : parameters.document;
  const resume = Array.isArray(parameters.resume) ? parameters.resume[0] : parameters.resume;

  if (documentId) {
    return <LocalDocumentReader documentId={documentId} resumeRequested={resume === "1"} />;
  }

  return <ReaderStart />;
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { GeneralReader } from "../../../components/general-library/general-reader";
import { generalLibraryPageState } from "../../../library-access/page-access";
import { generalLibraryPath } from "../../../library/general-library";

/** Depende de la cookie de sesión y de que el código siga activo: nunca se pre-genera. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Biblioteca general",
};

export default async function GeneralReaderPage({
  searchParams,
}: {
  searchParams: Promise<{ libro?: string | string[]; resume?: string | string[] }>;
}) {
  const parameters = await searchParams;
  const fileId = Array.isArray(parameters.libro) ? parameters.libro[0] : parameters.libro;
  const resume = Array.isArray(parameters.resume) ? parameters.resume[0] : parameters.resume;
  const { access, apiKey } = await generalLibraryPageState();
  // Sin sesión, o sin libro, de vuelta a la entrada.
  if (!access || !fileId || !/^[\w-]{10,200}$/.test(fileId)) redirect(generalLibraryPath);
  return <GeneralReader apiKey={apiKey} fileId={fileId} folderId={access.folderId} resumeRequested={resume === "1"} />;
}

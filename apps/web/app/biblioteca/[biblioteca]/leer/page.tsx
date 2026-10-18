import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { GeneralReader } from "../../../components/general-library/general-reader";
import { sharedSlugFromParam } from "../../../library-access/library-slug";
import { sharedLibraryPageState } from "../../../library-access/page-access";
import { sharedLibraryPlace } from "../../../library/general-library";

/** Depende de la cookie de sesión y de que la biblioteca y el código sigan abiertos: nunca se pre-genera. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Biblioteca compartida",
};

export default async function SharedReaderPage({
  params,
  searchParams,
}: {
  params: Promise<{ biblioteca: string }>;
  searchParams: Promise<{ libro?: string | string[]; resume?: string | string[] }>;
}) {
  const [{ biblioteca }, parameters] = await Promise.all([params, searchParams]);
  const slug = sharedSlugFromParam(biblioteca);
  if (!slug || slug !== biblioteca) notFound();
  const fileId = Array.isArray(parameters.libro) ? parameters.libro[0] : parameters.libro;
  const resume = Array.isArray(parameters.resume) ? parameters.resume[0] : parameters.resume;
  const { access, apiKey } = await sharedLibraryPageState(slug);
  // Sin sesión, o sin libro, de vuelta a la entrada.
  if (!access || !fileId || !/^[\w-]{10,200}$/.test(fileId)) redirect(`/biblioteca/${slug}`);
  return (
    <GeneralReader
      apiKey={apiKey}
      fileId={fileId}
      folderId={access.library.folderId}
      place={sharedLibraryPlace(slug, access.library.name)}
      resumeRequested={resume === "1"}
    />
  );
}

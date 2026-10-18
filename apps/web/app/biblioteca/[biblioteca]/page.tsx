import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { AccessForm } from "../../components/general-library/access-form";
import { GeneralLibraryView } from "../../components/general-library/general-library-view";
import { GeneralShell } from "../../components/general-library/general-shell";
import { GeneralLibraryUnavailable } from "../../components/general-library/general-unavailable";
import { sharedSlugFromParam } from "../../library-access/library-slug";
import { sharedLibraryPageState } from "../../library-access/page-access";
import { sharedLibraryPlace } from "../../library/general-library";

/** Depende de la cookie de sesión y de que la biblioteca y el código sigan abiertos: nunca se pre-genera. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  description: "Una biblioteca compartida en Pliegue: se entra con un código de acceso.",
  robots: { follow: false, index: false },
  title: "Biblioteca compartida",
};

/**
 * `/biblioteca/luis-lara`: la biblioteca compartida de una cuenta, igual que la general (que
 * tiene su propia carpeta de rutas y gana a esta). Sin sesión, la entrada; con ella, los libros.
 */
export default async function SharedLibraryPage({ params }: { params: Promise<{ biblioteca: string }> }) {
  const { biblioteca } = await params;
  const slug = sharedSlugFromParam(biblioteca);
  if (!slug) notFound();
  if (slug !== biblioteca) redirect(`/biblioteca/${slug}`);

  const { access, apiKey, library } = await sharedLibraryPageState(slug);
  if (!library) {
    return (
      <GeneralShell place={sharedLibraryPlace(slug, "Biblioteca compartida")} visitor={null}>
        <GeneralLibraryUnavailable shared />
      </GeneralShell>
    );
  }
  const place = sharedLibraryPlace(slug, library.name);
  if (!access) {
    return (
      <GeneralShell place={place} visitor={null}>
        <AccessForm place={place} />
      </GeneralShell>
    );
  }
  return (
    <GeneralShell place={place} visitor={access.session.name}>
      <GeneralLibraryView apiKey={apiKey} folderId={library.folderId} place={place} />
    </GeneralShell>
  );
}

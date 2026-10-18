import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { AccessForm } from "../../../components/general-library/access-form";
import { GeneralShell } from "../../../components/general-library/general-shell";
import { GeneralLibraryUnavailable } from "../../../components/general-library/general-unavailable";
import { sharedSlugFromParam } from "../../../library-access/library-slug";
import { isCurrentAccessCode, sharedLibraryPageState } from "../../../library-access/page-access";
import { sharedLibraryPlace } from "../../../library/general-library";

/** Depende de la cookie de sesión y de que la biblioteca y el código sigan abiertos: nunca se pre-genera. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Biblioteca compartida",
};

/**
 * `/biblioteca/luis-lara/OCT26`: el código ya viene puesto; solo falta el nombre. Como en la
 * general: con el mismo código con el que ya se está dentro, directo a la biblioteca; con otro,
 * hay que entrar con él para que se valide y quede registrado.
 */
export default async function SharedLibraryCodePage({ params }: { params: Promise<{ biblioteca: string; codigo: string }> }) {
  const { biblioteca, codigo } = await params;
  const slug = sharedSlugFromParam(biblioteca);
  if (!slug) notFound();
  let code = codigo;
  try {
    code = decodeURIComponent(codigo);
  } catch {
    // Una dirección mal escrita: se deja tal cual y el formulario dirá si no vale.
  }
  code = code.slice(0, 40);
  if (slug !== biblioteca) redirect(`/biblioteca/${slug}/${encodeURIComponent(code)}`);

  const { access, library } = await sharedLibraryPageState(slug);
  if (!library) {
    return (
      <GeneralShell place={sharedLibraryPlace(slug, "Biblioteca compartida")} visitor={null}>
        <GeneralLibraryUnavailable shared />
      </GeneralShell>
    );
  }
  const place = sharedLibraryPlace(slug, library.name);
  if (access && (await isCurrentAccessCode(code, access.session.codeId, slug))) redirect(place.path);
  return (
    <GeneralShell place={place} visitor={access?.session.name ?? null}>
      <AccessForm activeName={access?.session.name ?? null} initialCode={code} place={place} />
    </GeneralShell>
  );
}

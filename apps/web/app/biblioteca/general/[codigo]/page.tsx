import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AccessForm } from "../../../components/general-library/access-form";
import { GeneralShell } from "../../../components/general-library/general-shell";
import { GeneralLibraryUnavailable } from "../../../components/general-library/general-unavailable";
import { generalLibraryPageState } from "../../../library-access/page-access";
import { generalLibraryPath } from "../../../library/general-library";

/** Depende de la cookie de sesión y de que el código siga activo: nunca se pre-genera. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Biblioteca general",
};

/** `/biblioteca/general/OCT2026AREQUIPA`: el código ya viene puesto; solo falta el nombre. */
export default async function GeneralLibraryCodePage({ params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params;
  const { access, configured } = await generalLibraryPageState();
  if (access) redirect(generalLibraryPath);
  let code = codigo;
  try {
    code = decodeURIComponent(codigo);
  } catch {
    // Una dirección mal escrita: se deja tal cual y el formulario dirá si no vale.
  }
  return (
    <GeneralShell visitor={null}>
      {configured ? <AccessForm initialCode={code.slice(0, 40)} /> : <GeneralLibraryUnavailable />}
    </GeneralShell>
  );
}

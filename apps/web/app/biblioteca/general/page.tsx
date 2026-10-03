import type { Metadata } from "next";

import { AccessForm } from "../../components/general-library/access-form";
import { GeneralLibraryView } from "../../components/general-library/general-library-view";
import { GeneralShell } from "../../components/general-library/general-shell";
import { GeneralLibraryUnavailable } from "../../components/general-library/general-unavailable";
import { generalLibraryPageState } from "../../library-access/page-access";

/** Depende de la cookie de sesión y de que el código siga activo: nunca se pre-genera. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  description: "La biblioteca general de Pliegue: se entra con un código de acceso.",
  robots: { follow: false, index: false },
  title: "Biblioteca general",
};

export default async function GeneralLibraryPage() {
  const { access, apiKey, configured } = await generalLibraryPageState();
  if (!configured) {
    return (
      <GeneralShell visitor={null}>
        <GeneralLibraryUnavailable />
      </GeneralShell>
    );
  }
  if (!access) {
    return (
      <GeneralShell visitor={null}>
        <AccessForm />
      </GeneralShell>
    );
  }
  return (
    <GeneralShell visitor={access.session.name}>
      <GeneralLibraryView apiKey={apiKey} folderId={access.folderId} />
    </GeneralShell>
  );
}

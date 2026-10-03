import type { Metadata } from "next";

import { LibraryAdminPanel } from "../../../../components/admin/library-admin-panel";
import { PageHeader } from "../../../../components/workspace-page";

export const metadata: Metadata = {
  description: "Códigos de acceso a la biblioteca general y registro de entradas.",
  robots: { follow: false, index: false },
  title: "Biblioteca general",
};

export default function LibraryAdminPage() {
  return (
    <>
      <PageHeader
        description="Códigos de acceso y quién entró con ellos."
        eyebrow="Administración"
        title="Biblioteca general"
      />
      <LibraryAdminPanel />
    </>
  );
}

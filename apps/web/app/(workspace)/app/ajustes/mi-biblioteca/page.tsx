import type { Metadata } from "next";

import { SharedLibraryOwnerPanel } from "../../../../components/admin/shared-library-owner-panel";
import { PageHeader } from "../../../../components/workspace-page";

export const metadata: Metadata = {
  description: "Tu biblioteca compartida: códigos de acceso y registro de entradas.",
  robots: { follow: false, index: false },
  title: "Mi biblioteca compartida",
};

export default function SharedLibraryOwnerPage() {
  return (
    <>
      <PageHeader description="Códigos de acceso y quién entró con ellos." eyebrow="Biblioteca compartida" title="Mi biblioteca compartida" />
      <SharedLibraryOwnerPanel />
    </>
  );
}

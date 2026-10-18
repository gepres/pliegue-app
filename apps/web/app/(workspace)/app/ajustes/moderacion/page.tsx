import type { Metadata } from "next";

import { ModerationPanel } from "../../../../components/admin/moderation-panel";
import { PageHeader } from "../../../../components/workspace-page";

export const metadata: Metadata = {
  description: "Bibliotecas compartidas, denuncias y avisos.",
  robots: { follow: false, index: false },
  title: "Moderación",
};

export default function ModerationPage() {
  return (
    <>
      <PageHeader description="Bibliotecas compartidas, denuncias y avisos a sus dueños." eyebrow="Administración" title="Moderación" />
      <ModerationPanel />
    </>
  );
}

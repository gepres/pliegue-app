import type { Metadata } from "next";

import { WorkspaceDashboard } from "../../components/workspace-dashboard";

export const metadata: Metadata = {
  title: "Inicio",
  description: "Resumen del Área personal de Pliegue y lecturas recientes.",
};

export default function WorkspaceHomePage() {
  return <WorkspaceDashboard />;
}

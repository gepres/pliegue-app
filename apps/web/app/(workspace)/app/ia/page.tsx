import type { Metadata } from "next";

import { Card, Tag } from "@pliegue/ui";

import { publicConfig } from "../../../config/public-config";
import { AiCatalogDashboard } from "../../../components/ai-catalog-dashboard";
import { PageHeader } from "../../../components/workspace-page";
import styles from "../workspace.module.css";

export const metadata: Metadata = {
  title: "Panel de IA",
  description: "Consultas trazables sobre los documentos guardados en Pliegue.",
};

export default function AiPage() {
  if (!publicConfig.features.aiPanel) {
    return (
      <>
        <PageHeader
          description="La superficie de IA está desactivada en este entorno. Tus documentos siguen disponibles sin procesamiento externo."
          eyebrow={`Feature flag · ${publicConfig.environment}`}
          title="Panel de IA"
        />
        <Card className={styles.settingsCard}>
          <Tag>Privacidad por defecto</Tag>
          <h2>IA desactivada</h2>
          <p>
            Activa la función únicamente en un entorno autorizado y después de
            configurar una bóveda segura para las credenciales BYOK.
          </p>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        description="Consulta tus documentos con respuestas trazables y control sobre el proveedor."
        eyebrow="BYOK · Evidencia primero"
        title="Panel de IA"
      />

      <AiCatalogDashboard />
    </>
  );
}

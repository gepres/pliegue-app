import type { Metadata } from "next";

import { Button, Card, Tag } from "@pliegue/ui";

import { publicConfig } from "../../../config/public-config";
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

      <div className={styles.aiPanel}>
        <Card className={styles.conversation}>
          <Tag>Consulta del espacio</Tag>
          <div className={styles.message}>
            <strong>Pliegue</strong>
            <p>
              Puedo ayudarte a resumir, comparar o conectar ideas. Cada respuesta
              mostrará los documentos y fragmentos utilizados como evidencia.
            </p>
          </div>
          <form className={styles.promptForm}>
            <div className={styles.promptField}>
              <label htmlFor="ai-prompt">Pregunta sobre tus documentos</label>
              <input
                id="ai-prompt"
                name="prompt"
                placeholder="Compara las ideas principales…"
              />
            </div>
            <Button type="submit">Preguntar</Button>
          </form>
        </Card>

        <Card>
          <Tag>Proveedores · {publicConfig.environment}</Tag>
          <h2>Sin credenciales</h2>
          <p>
            Añade tu clave de OpenAI, Claude o una URL de Ollama desde Ajustes. Las
            credenciales serán personales y no se incluirán en el repositorio.
          </p>
        </Card>
      </div>
    </>
  );
}

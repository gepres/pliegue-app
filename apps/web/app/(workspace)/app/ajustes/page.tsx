import type { Metadata } from "next";

import { Card, Tag } from "@pliegue/ui";

import { PreferencesPanel } from "../../../components/preferences-panel";
import { WorkspaceModePanel } from "../../../components/workspace-mode-panel";
import { AiSettingsPanel } from "../../../components/ai-settings-panel";
import { PageHeader } from "../../../components/workspace-page";
import styles from "../workspace.module.css";

export const metadata: Metadata = {
  title: "Ajustes",
  description: "Preferencias de apariencia, fuentes, IA y privacidad de Pliegue.",
};

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        description="Configura apariencia, privacidad, almacenamiento y proveedores sin perder control de tus datos."
        eyebrow="Preferencias personales"
        title="Ajustes"
      />

      <PreferencesPanel />
      <WorkspaceModePanel />
      <AiSettingsPanel />

      <section aria-label="Otras categorías de ajustes" className={styles.settingsGrid}>
        <Card className={styles.settingsCard}>
          <Tag>Fuentes</Tag>
          <h2>Drive y archivos locales</h2>
          <p>Administra ubicaciones conectadas, permisos y disponibilidad offline.</p>
          <span className={styles.pendingLabel}>Próximo incremento</span>
        </Card>
        <Card className={styles.settingsCard}>
          <Tag>Privacidad</Tag>
          <h2>Datos y portabilidad</h2>
          <p>Revisa retención, exportación, copias de seguridad y borrado.</p>
          <span className={styles.pendingLabel}>Política en definición</span>
        </Card>
      </section>
    </>
  );
}

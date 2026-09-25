import type { Metadata } from "next";

import { Card, Tag } from "@pliegue/ui";

import { AiSettingsPanel } from "../../../components/ai-settings-panel";
import { PreferencesPanel } from "../../../components/preferences-panel";
import { SettingsLayout } from "../../../components/settings/settings-layout";
import { WorkspaceModePanel } from "../../../components/workspace-mode-panel";
import styles from "../workspace.module.css";

export const metadata: Metadata = {
  title: "Ajustes",
  description: "Preferencias de apariencia, fuentes, IA y privacidad de Pliegue.",
};

export default function SettingsPage() {
  return (
    <SettingsLayout
      sections={[
        {
          content: <PreferencesPanel />,
          description: "Tema, tipografía, tamaño e interlineado por nivel",
          icon: "typography",
          id: "lectura",
          label: "Lectura y apariencia",
        },
        {
          content: <WorkspaceModePanel />,
          description: "Modo local y dónde viven tus datos",
          icon: "monitor",
          id: "espacio",
          label: "Espacio de trabajo",
        },
        {
          content: <AiSettingsPanel />,
          description: "Proveedor, credencial y catálogo automático",
          icon: "sparkles",
          id: "ia",
          label: "Inteligencia artificial",
        },
        {
          content: (
            <Card className={styles.settingsCard}>
              <Tag>Próximo incremento</Tag>
              <h2>Drive y archivos locales</h2>
              <p>Administra ubicaciones conectadas, permisos y disponibilidad offline.</p>
            </Card>
          ),
          description: "Ubicaciones conectadas y permisos",
          icon: "folder",
          id: "fuentes",
          label: "Fuentes",
        },
        {
          content: (
            <Card className={styles.settingsCard}>
              <Tag>Política en definición</Tag>
              <h2>Datos y portabilidad</h2>
              <p>Revisa retención, exportación, copias de seguridad y borrado.</p>
            </Card>
          ),
          description: "Retención, exportación y borrado",
          icon: "database",
          id: "datos",
          label: "Datos y portabilidad",
        },
      ]}
    />
  );
}

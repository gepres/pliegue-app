import type { Metadata } from "next";

import { AiSettingsPanel } from "../../../components/ai-settings-panel";
import { AccountPanel } from "../../../components/cloud/account-panel";
import { InstallAppCard } from "../../../components/pwa/install-app";
import { PreferencesPanel } from "../../../components/preferences-panel";
import { DataSettingsPanel } from "../../../components/settings/data-settings-panel";
import { SettingsLayout } from "../../../components/settings/settings-layout";
import { SourcesSettingsPanel } from "../../../components/settings/sources-settings-panel";
import { WorkspaceModePanel } from "../../../components/workspace-mode-panel";
import styles from "../workspace.module.css";

export const metadata: Metadata = {
  title: "Ajustes",
  description: "Cuenta, preferencias de apariencia, fuentes, IA y privacidad de Pliegue.",
};

export default function SettingsPage() {
  return (
    <SettingsLayout
      sections={[
        {
          content: <AccountPanel />,
          description: "Opcional: tu biblioteca en todos tus equipos",
          icon: "cloud",
          id: "cuenta",
          label: "Cuenta y sincronización",
        },
        {
          content: <PreferencesPanel />,
          description: "Tema, tipografía, tamaño e interlineado por nivel",
          icon: "typography",
          id: "lectura",
          label: "Lectura y apariencia",
        },
        {
          content: (
            <div className={styles.settingsStack}>
              <WorkspaceModePanel />
              <InstallAppCard />
            </div>
          ),
          description: "Modo local, app de escritorio y dónde viven tus datos",
          icon: "monitor",
          id: "espacio",
          label: "Espacio de trabajo",
        },
        {
          content: <AiSettingsPanel />,
          description: "Proveedor, clave, catálogo y traducción",
          icon: "sparkles",
          id: "ia",
          label: "Inteligencia artificial",
        },
        {
          content: <SourcesSettingsPanel />,
          description: "Ubicaciones, permisos y datos guardados",
          icon: "folder",
          id: "fuentes",
          label: "Fuentes",
        },
        {
          content: <DataSettingsPanel />,
          description: "Copia de seguridad, exportación y borrado",
          icon: "database",
          id: "datos",
          label: "Datos y portabilidad",
        },
      ]}
    />
  );
}

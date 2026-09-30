"use client";

import { Button, Card, Tag } from "@pliegue/ui";

import {
  confirmLocalOnlyMode,
  useWorkspaceMode,
} from "../mode/workspace-mode-store";
import styles from "../(workspace)/app/workspace.module.css";

export function WorkspaceModePanel() {
  const workspaceMode = useWorkspaceMode();
  const isConfirmed = workspaceMode.confirmedAt !== null;

  return (
    <Card
      aria-labelledby="local-mode-title"
      className={styles.localModeCard}
      id="modo-local"
      tone="subtle"
    >
      <div>
        <Tag>Cuenta · local-only</Tag>
        <h2 id="local-mode-title">Tus archivos permanecen en este dispositivo</h2>
        <p>
          Puedes usar Pliegue sin crear una cuenta. Sin ella no hay sincronización entre equipos
          ni recuperación remota, y con ella tampoco se suben tus archivos ni las copias
          importadas: solo lo que sabes de ellos.
        </p>
      </div>
      <ul className={styles.localModeList}>
        <li>Sin correo, contraseña ni proveedor externo.</li>
        <li>Metadatos y copias se guardan en el almacenamiento del navegador.</li>
        <li>Borrar los datos del sitio elimina esta biblioteca local.</li>
      </ul>
      <div className={styles.localModeActions}>
        <Button disabled={isConfirmed} onClick={confirmLocalOnlyMode} variant="secondary">
          {isConfirmed ? "Modo local confirmado" : "Confirmar modo local"}
        </Button>
        <span aria-live="polite" role="status">
          {isConfirmed
            ? "Este dispositivo está configurado como local-only."
            : "La cuenta es opcional: se activa en «Cuenta y sincronización»."}
        </span>
      </div>
    </Card>
  );
}

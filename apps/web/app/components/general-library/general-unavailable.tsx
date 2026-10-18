import { Card, Tag } from "@pliegue/ui";

import styles from "./general-library.module.css";

/**
 * La general, sin la carpeta, la clave secreta o la de Google en el servidor, no abre. Una
 * compartida, tampoco si no existe o su dueño la cerró: no se distingue, para no dar pistas.
 */
export function GeneralLibraryUnavailable({ shared = false }: { shared?: boolean }) {
  if (shared) {
    return (
      <Card as="section" className={styles.accessCard}>
        <Tag>Biblioteca compartida</Tag>
        <h1>No está disponible</h1>
        <p className={styles.lead}>Esta biblioteca no existe o su dueño la cerró por ahora. Pregunta a quien te dio el enlace.</p>
      </Card>
    );
  }
  return (
    <Card as="section" className={styles.accessCard}>
      <Tag>Biblioteca general</Tag>
      <h1>Todavía no está abierta</h1>
      <p className={styles.lead}>La biblioteca general de Pliegue aún no está disponible. Vuelve a intentarlo más tarde.</p>
    </Card>
  );
}

import { Card, Tag } from "@pliegue/ui";

import styles from "./general-library.module.css";

/** Sin la carpeta, la clave secreta o la de Google en el servidor, la biblioteca no abre. */
export function GeneralLibraryUnavailable() {
  return (
    <Card as="section" className={styles.accessCard}>
      <Tag>Biblioteca general</Tag>
      <h1>Todavía no está abierta</h1>
      <p className={styles.lead}>La biblioteca general de Pliegue aún no está disponible. Vuelve a intentarlo más tarde.</p>
    </Card>
  );
}

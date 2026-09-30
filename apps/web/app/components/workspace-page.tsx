import type { ReactNode } from "react";

import { Card, Tag, cx } from "@pliegue/ui";

import styles from "./workspace-page.module.css";

export function PageHeader({
  actions,
  compact = false,
  description,
  eyebrow,
  title,
}: {
  actions?: ReactNode;
  /**
   * Cede el protagonismo a lo que hay debajo. Pensado para el lector: ahí el título es el
   * nombre de un archivo del disco —a menudo largo y sin espacios— y a tamaño de portada
   * empujaba el documento fuera de la pantalla antes de haber leído una línea.
   */
  compact?: boolean;
  description: string;
  eyebrow: string;
  title: string;
}) {
  return (
    <header className={cx(styles.pageHeader, compact && styles.pageHeaderCompact)}>
      <div className={styles.pageHeading}>
        <Tag>{eyebrow}</Tag>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions ? <div className={styles.pageActions}>{actions}</div> : null}
    </header>
  );
}

export function MetricCard({
  detail,
  label,
  value,
}: {
  detail: string;
  label: string;
  value: string;
}) {
  return (
    <Card className={styles.metricCard}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </Card>
  );
}

export function DocumentCard({
  children,
  eyebrow,
  title,
}: {
  children: ReactNode;
  eyebrow: string;
  title: string;
}) {
  return (
    <Card className={styles.documentCard}>
      <span>{eyebrow}</span>
      <h3>{title}</h3>
      {children}
    </Card>
  );
}

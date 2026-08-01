import type { ReactNode } from "react";

import { Card, Tag } from "@pliegue/ui";

import styles from "./workspace-page.module.css";

export function PageHeader({
  actions,
  description,
  eyebrow,
  title,
}: {
  actions?: ReactNode;
  description: string;
  eyebrow: string;
  title: string;
}) {
  return (
    <header className={styles.pageHeader}>
      <div>
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

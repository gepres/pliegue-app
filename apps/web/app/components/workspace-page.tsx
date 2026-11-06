import type { ReactNode } from "react";

import { Card, Tag, cx } from "@pliegue/ui";

import { Skeleton, SkeletonGroup, SkeletonText } from "./app-ui/skeleton";
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
  loading = false,
  value,
}: {
  detail: string;
  label: string;
  /** Mientras llegan los datos: la cifra y su detalle, como esqueleto (no «—» ni un 0 que salta). */
  loading?: boolean;
  value: string;
}) {
  return (
    <Card aria-busy={loading || undefined} className={styles.metricCard}>
      <span>{label}</span>
      {loading ? (
        <>
          <strong>
            <Skeleton height="1em" width="2.2ch" />
          </strong>
          <small>
            <SkeletonText lastWidth="75%" lines={1} />
          </small>
        </>
      ) : (
        <>
          <strong>{value}</strong>
          <small>{detail}</small>
        </>
      )}
    </Card>
  );
}

/** La forma de una `DocumentCard` mientras se recuperan los documentos. */
export function DocumentCardSkeletons({ className, count = 3, label }: { className?: string | undefined; count?: number; label: string }) {
  return (
    <SkeletonGroup as="section" className={className} label={label}>
      {Array.from({ length: count }, (_, index) => (
        <Card className={styles.documentCard} key={index}>
          <Skeleton height="0.6875rem" width="38%" />
          <Skeleton height="1.5rem" width="72%" />
          <SkeletonText lastWidth="55%" lines={2} />
          <span className={styles.skeletonActions}>
            <Skeleton height="1.5rem" radius={999} width="5.5rem" />
            <Skeleton height="2rem" radius={999} width="4.5rem" />
          </span>
        </Card>
      ))}
    </SkeletonGroup>
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

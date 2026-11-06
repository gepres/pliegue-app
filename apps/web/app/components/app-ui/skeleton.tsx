import type { CSSProperties, ReactNode } from "react";

import { cx } from "@pliegue/ui";

import styles from "./skeleton.module.css";

/**
 * Esqueletos de carga: la forma de lo que va a llegar mientras llega, para que la página no
 * salte al pintarse ni diga «Cargando…» donde ya se sabe qué habrá. Los bloques son
 * decorativos (`aria-hidden`); lo que se anuncia es el grupo, con `role="status"` y su
 * etiqueta. Aparecen con un retraso corto: si los datos llegan antes (IndexedDB suele tardar
 * unos milisegundos), no hay parpadeo.
 */

type Size = number | string;

const size = (value: Size | undefined) => (typeof value === "number" ? `${value}px` : value);

/** Un bloque: una línea de texto, una cifra, una portada, un botón. */
export function Skeleton({
  className,
  height,
  label,
  radius,
  shape = "block",
  width,
}: {
  className?: string | undefined;
  height?: Size;
  /** Lo que oye el lector de pantalla en su lugar, cuando no hay un grupo que lo anuncie. */
  label?: string;
  radius?: Size;
  /** `inline`: dentro de una frase, en lugar de una palabra («Cargando…»). */
  shape?: "block" | "circle" | "inline" | "text";
  width?: Size;
}) {
  const style: CSSProperties = {};
  if (width !== undefined) style.width = size(width);
  if (height !== undefined) style.height = size(height);
  if (radius !== undefined) style.borderRadius = size(radius);
  const block = <span aria-hidden="true" className={cx(styles.skeleton, styles[shape], className)} style={style} />;
  if (!label) return block;
  return (
    <>
      {block}
      <span className={styles.srOnly}>{label}</span>
    </>
  );
}

/**
 * Varias líneas de texto; la última, más corta, como en un párrafo de verdad. `label` es lo que
 * oye el lector de pantalla en su lugar («Cargando…»), cuando no hay un grupo que lo anuncie.
 */
export function SkeletonText({
  className,
  label,
  lastWidth = "60%",
  lines = 3,
}: {
  className?: string | undefined;
  label?: string;
  lastWidth?: Size;
  lines?: number;
}) {
  return (
    <>
      <span aria-hidden="true" className={cx(styles.lines, className)}>
        {Array.from({ length: lines }, (_, index) => (
          <Skeleton key={index} shape="text" width={index === lines - 1 && lines > 1 ? lastWidth : "100%"} />
        ))}
      </span>
      {label ? <span className={styles.srOnly}>{label}</span> : null}
    </>
  );
}

/**
 * Los esqueletos de una zona y lo que se anuncia mientras están: «Cargando tus documentos» para
 * el lector de pantalla, los esqueletos para la vista. `as` deja usarlo como la misma etiqueta
 * que tendrá el contenido (una `section` de la cuadrícula, una `ul` de fichas…), con su misma
 * clase de maquetación.
 *
 * El aviso va aparte, con su texto dentro: una región viva anuncia el texto que contiene, no su
 * `aria-label`, y los esqueletos no tienen texto. El dibujo queda entero fuera del árbol de
 * accesibilidad, así que una lista en esqueleto no deja elementos de lista vacíos.
 */
export function SkeletonGroup({
  as: Tag = "div",
  children,
  className,
  label,
}: {
  as?: "div" | "section" | "span" | "ul";
  children: ReactNode;
  className?: string | undefined;
  /** Sin etiqueta es solo decorativo: lo que se anuncia ya lo dice un texto de al lado. */
  label?: string;
}) {
  const drawing = (
    <Tag aria-hidden="true" className={cx(styles.group, className)} data-skeleton="">
      {children}
    </Tag>
  );
  if (!label) return drawing;
  return (
    <>
      <span aria-live="polite" className={styles.srOnly} data-skeleton-status="" role="status">
        {label}
      </span>
      {drawing}
    </>
  );
}

/** Una página de documento: el papel con su título y unos párrafos, para los lectores. */
export function SkeletonPage({ className }: { className?: string | undefined }) {
  return (
    <span aria-hidden="true" className={cx(styles.page, className)}>
      <Skeleton height="1.6rem" width="55%" />
      {[3, 4, 2].map((lines, index) => (
        <SkeletonText key={index} lastWidth={index === 2 ? "40%" : "70%"} lines={lines} />
      ))}
    </span>
  );
}

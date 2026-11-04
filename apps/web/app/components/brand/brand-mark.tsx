import { cx } from "@pliegue/ui";

import styles from "./brand-mark.module.css";

/**
 * La marca de Pliegue: el libro abierto, en el verde de la acción principal y con la página en
 * color papel. Va en línea y no como `<img>` para seguir el tema que elige la persona (Claro,
 * Oscuro o Sistema): en oscuro, el verde se aclara y el libro se lee sobre el fondo. El SVG de
 * `public/brand` traía dos rectángulos de fondo (gris y papel) que la dejaban como un cuadro
 * claro en el tema oscuro (02.8). El lienzo de 88 × 88 conserva el aire de siempre alrededor.
 */
export function BrandMark({ className, size = 30 }: { className?: string; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      className={cx(styles.mark, className)}
      focusable="false"
      height={size}
      viewBox="0 0 88 88"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        className={styles.body}
        d="M16 10H54C65 10 74 19 74 30V78H16V10ZM29 22V65C37 60 45 58 53 58V30C53 25 50 22 45 22H29ZM56 24V58C60 59 63 60 66 62V30C66 27 62 24 56 24Z"
      />
      <path className={styles.page} d="M29 22H45C50 22 53 25 53 30V58C45 58 37 60 29 65V22Z" />
    </svg>
  );
}

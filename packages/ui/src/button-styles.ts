import { cx } from "./utils";

/**
 * `danger` es una acción destructiva discreta —borrar una clave, descartar lo importado—:
 * texto en el color de peligro sin fondo sólido, para que avise sin gritar en una fila de
 * acciones corrientes.
 */
export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

interface ButtonStyleOptions {
  className?: string | undefined;
  size?: ButtonSize | undefined;
  variant?: ButtonVariant | undefined;
}

export function buttonClassName({
  className,
  size = "md",
  variant = "primary",
}: ButtonStyleOptions = {}) {
  return cx(
    "pliegue-button",
    `pliegue-button--${variant}`,
    `pliegue-button--${size}`,
    className,
  );
}

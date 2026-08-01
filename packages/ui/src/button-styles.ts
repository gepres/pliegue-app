import { cx } from "./utils";

export type ButtonVariant = "primary" | "secondary" | "quiet";
export type ButtonSize = "sm" | "md";

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

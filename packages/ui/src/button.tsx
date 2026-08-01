import type { ButtonHTMLAttributes } from "react";

import {
  buttonClassName,
  type ButtonSize,
  type ButtonVariant,
} from "./button-styles";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: ButtonSize;
  variant?: ButtonVariant;
}

export function Button({
  className,
  size = "md",
  type = "button",
  variant = "primary",
  ...props
}: ButtonProps) {
  return (
    <button
      className={buttonClassName({ className, size, variant })}
      type={type}
      {...props}
    />
  );
}

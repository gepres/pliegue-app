import type { InputHTMLAttributes } from "react";

import { cx } from "./utils";

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export function Input({ className, ...props }: InputProps) {
  return <input className={cx("pliegue-input", className)} {...props} />;
}

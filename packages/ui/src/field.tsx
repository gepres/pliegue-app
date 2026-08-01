import type { HTMLAttributes, ReactNode } from "react";

import { cx } from "./utils";

export interface FieldProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  description?: string;
  label: string;
  labelFor: string;
}

export function Field({
  children,
  className,
  description,
  label,
  labelFor,
  ...props
}: FieldProps) {
  return (
    <div className={cx("pliegue-field", className)} {...props}>
      <label className="pliegue-field__label" htmlFor={labelFor}>
        {label}
      </label>
      {children}
      {description ? <p className="pliegue-field__description">{description}</p> : null}
    </div>
  );
}

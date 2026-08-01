import type { SelectHTMLAttributes } from "react";

import { cx } from "./utils";

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export function Select({ className, ...props }: SelectProps) {
  return <select className={cx("pliegue-select", className)} {...props} />;
}

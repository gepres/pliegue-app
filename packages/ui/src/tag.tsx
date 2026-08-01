import type { HTMLAttributes } from "react";

import { cx } from "./utils";

export function Tag({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cx("pliegue-tag", className)} {...props} />;
}

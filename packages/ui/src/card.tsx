import type { HTMLAttributes } from "react";

import { cx } from "./utils";

export interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: "article" | "section";
  tone?: "surface" | "subtle";
}

export function Card({
  as: Component = "article",
  className,
  tone = "surface",
  ...props
}: CardProps) {
  return (
    <Component
      className={cx("pliegue-card", `pliegue-card--${tone}`, className)}
      {...props}
    />
  );
}

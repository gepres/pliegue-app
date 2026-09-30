import type { InputHTMLAttributes, ReactNode } from "react";

import { cx } from "./utils";

export interface SwitchProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "children" | "role" | "type"> {
  /** Texto breve bajo la etiqueta que explica qué cambia al activarlo. */
  description?: ReactNode;
  label: ReactNode;
}

/**
 * Un ajuste que se enciende o se apaga y surte efecto al momento.
 *
 * Es un checkbox nativo con `role="switch"`: conserva el teclado, el formulario y el estado
 * que anuncia el lector de pantalla («activado», «desactivado»). La etiqueta envuelve el
 * control, así que toda la fila es pulsable.
 */
export function Switch({ className, description, label, ...props }: SwitchProps) {
  return (
    <label className={cx("pliegue-switch", className)}>
      <span className="pliegue-switch__text">
        <span className="pliegue-switch__label">{label}</span>
        {description ? (
          <span className="pliegue-switch__description">{description}</span>
        ) : null}
      </span>
      <input className="pliegue-switch__control" role="switch" type="checkbox" {...props} />
    </label>
  );
}

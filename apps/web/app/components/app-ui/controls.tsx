"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";

import { cx } from "@pliegue/ui";

import { Icon, type IconName } from "./icons";
import styles from "./app-ui.module.css";

/* ---- Botón de icono -------------------------------------------------------- */

export interface IconButtonProps extends ComponentProps<"button"> {
  icon: IconName;
  /** Nombre accesible y rótulo emergente. Un icono sin palabras necesita las dos cosas. */
  label: string;
  /** Atajo de teclado que se añade al rótulo emergente, p. ej. «F». */
  shortcut?: string;
  tone?: "plain" | "filled" | "active";
  size?: "sm" | "md";
  badge?: number | undefined;
}

export function IconButton({
  badge,
  className,
  icon,
  label,
  shortcut,
  size = "md",
  tone = "plain",
  type = "button",
  ...props
}: IconButtonProps) {
  return (
    <button
      aria-label={label}
      className={cx(
        styles.iconButton,
        size === "sm" && styles.iconButtonSm,
        tone === "filled" && styles.iconButtonFilled,
        tone === "active" && styles.iconButtonActive,
        className,
      )}
      data-tooltip={shortcut ? `${label} · ${shortcut}` : label}
      type={type}
      {...props}
    >
      <Icon name={icon} size={size === "sm" ? 18 : 20} />
      {badge ? (
        <span aria-hidden="true" className={styles.badge}>
          {badge}
        </span>
      ) : null}
    </button>
  );
}

/* ---- Control segmentado ---------------------------------------------------- */

export interface SegmentOption<Value extends string | number> {
  icon?: IconName;
  label: string;
  /** Contenido visible distinto de la etiqueta accesible (p. ej. «Aa» en la fuente). */
  preview?: ReactNode;
  value: Value;
}

/**
 * Una elección entre pocas opciones que se ven todas a la vez. En una app es lo que
 * sustituye a un `<select>`: no hay que abrir nada para saber qué hay ni para cambiarlo.
 */
export function Segmented<Value extends string | number>({
  label,
  onChange,
  options,
  size = "md",
  value,
}: {
  label: string;
  onChange: (value: Value) => void;
  options: readonly SegmentOption<Value>[];
  size?: "sm" | "md";
  value: Value;
}) {
  return (
    <div
      aria-label={label}
      className={cx(styles.segmented, size === "sm" && styles.segmentedSm)}
      role="radiogroup"
    >
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <button
            aria-checked={checked}
            aria-label={option.preview ? option.label : undefined}
            className={styles.segment}
            key={String(option.value)}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
              event.preventDefault();
              const index = options.findIndex((item) => item.value === value);
              const delta = event.key === "ArrowRight" ? 1 : -1;
              const next = options[(index + delta + options.length) % options.length];
              if (!next) return;
              onChange(next.value);
              const siblings = event.currentTarget.parentElement?.querySelectorAll("button");
              siblings?.[options.indexOf(next)]?.focus();
            }}
            role="radio"
            tabIndex={checked ? 0 : -1}
            type="button"
          >
            {option.icon ? <Icon name={option.icon} size={16} /> : null}
            {option.preview ?? <span>{option.label}</span>}
          </button>
        );
      })}
    </div>
  );
}

/* ---- Sección desplegable --------------------------------------------------- */

/**
 * `<details>` con aspecto de fila de ajustes: accesible sin JavaScript, recuerda su estado
 * mientras la página vive y el resumen dice qué hay dentro antes de abrirlo.
 */
export function Disclosure({
  children,
  defaultOpen = false,
  icon,
  meta,
  summary,
  title,
}: {
  children: ReactNode;
  defaultOpen?: boolean;
  icon?: IconName;
  meta?: ReactNode;
  summary?: string;
  title: string;
}) {
  return (
    <details className={styles.disclosure} open={defaultOpen}>
      <summary className={styles.disclosureSummary}>
        {icon ? (
          <span className={styles.disclosureIcon}>
            <Icon name={icon} size={18} />
          </span>
        ) : null}
        <span className={styles.disclosureText}>
          <strong>{title}</strong>
          {summary ? <small>{summary}</small> : null}
        </span>
        {meta ? <span className={styles.disclosureMeta}>{meta}</span> : null}
        <Icon className={styles.disclosureChevron} name="chevronDown" size={18} />
      </summary>
      <div className={styles.disclosureBody}>{children}</div>
    </details>
  );
}

/* ---- Aviso efímero --------------------------------------------------------- */

/**
 * El estado de una acción —«2 importados», «índice al día»— aparece abajo y se va solo,
 * como en cualquier app. La región `status` se queda en el DOM para que el lector de
 * pantalla lo anuncie aunque el aviso ya no se vea.
 */
export function Toast({ message, nonce = 0 }: { message: string | null; nonce?: number }) {
  const [visible, setVisible] = useState(false);
  const [shown, setShown] = useState<string | null>(null);

  useEffect(() => {
    if (!message) return;
    // El aviso se reprograma en un fotograma: fijar estado de forma síncrona dentro del
    // efecto encadenaría un render de más por cada mensaje.
    const frame = window.requestAnimationFrame(() => {
      setShown(message);
      setVisible(true);
    });
    const timer = window.setTimeout(() => setVisible(false), 5200);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [message, nonce]);

  return (
    <div aria-live="polite" className={styles.toastRegion} role="status">
      <div className={styles.toast} data-visible={visible && shown ? "true" : "false"}>
        {shown}
        <button
          aria-label="Cerrar aviso"
          className={styles.toastClose}
          onClick={() => setVisible(false)}
          type="button"
        >
          <Icon name="close" size={14} />
        </button>
      </div>
    </div>
  );
}

/* ---- Utilidades ------------------------------------------------------------ */

/** Identificador estable para enlazar un control con el panel que abre. */
export function useStableId(prefix: string) {
  const id = useId();
  return `${prefix}-${id.replace(/:/g, "")}`;
}

/** Ejecuta `handler` al pulsar fuera de `ref` mientras `active` sea verdadero. */
export function useOutsidePointer(
  active: boolean,
  refs: ReadonlyArray<React.RefObject<HTMLElement | null>>,
  handler: () => void,
) {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!active) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (refs.some((ref) => ref.current?.contains(target ?? null))) return;
      handlerRef.current();
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
    // Las referencias son objetos estables: basta con saber si el panel está abierto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}

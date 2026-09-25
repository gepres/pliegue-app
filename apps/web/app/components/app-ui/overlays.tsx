"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { cx } from "@pliegue/ui";

import { useOutsidePointer, useStableId } from "./controls";
import { Icon, type IconName } from "./icons";
import styles from "./app-ui.module.css";

const focusableSelector =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/* ---- Popover --------------------------------------------------------------- */

export interface PopoverTriggerProps {
  "aria-controls": string;
  "aria-expanded": boolean;
  "aria-haspopup": "dialog" | "menu";
  onClick: () => void;
  ref: React.RefObject<HTMLButtonElement | null>;
}

/**
 * Panel flotante anclado a su botón: en escritorio cae bajo él; por debajo de 640 px sube
 * desde abajo como una hoja, porque ahí el pulgar llega mejor al borde inferior que a un
 * menú pegado a la barra de arriba.
 */
export function Popover({
  align = "end",
  children,
  kind = "dialog",
  onOpenChange,
  open: controlledOpen,
  placement = "below",
  title,
  trigger,
  width = 300,
}: {
  align?: "start" | "end" | "center";
  children: ReactNode | ((close: () => void) => ReactNode);
  kind?: "dialog" | "menu";
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
  placement?: "below" | "above";
  title: string;
  trigger: (props: PopoverTriggerProps) => ReactNode;
  width?: number;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useStableId("popover");

  const setOpen = useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [controlledOpen, onOpenChange],
  );

  // Cerrar desde dentro devuelve el foco al botón. Se pide con un contador y se hace en un
  // efecto: la función de cierre llega al contenido durante el render y no debe tocar refs.
  const [focusRequest, setFocusRequest] = useState(0);
  const close = useCallback(() => {
    setOpen(false);
    setFocusRequest((request) => request + 1);
  }, [setOpen]);

  useEffect(() => {
    if (focusRequest > 0) triggerRef.current?.focus();
  }, [focusRequest]);

  useOutsidePointer(open, [panelRef, triggerRef], () => setOpen(false));

  // El panel se pinta en `<body>` y se coloca con coordenadas fijas medidas del botón. Si
  // viviera junto a él heredaría el recorte y el `backdrop-filter` de las barras, que
  // convierten `position: fixed` en relativo a la barra y dejan la hoja móvil fuera de sitio.
  const [coordinates, setCoordinates] = useState<React.CSSProperties>({});
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setMounted(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const next: Record<string, string> = {};
      if (placement === "above") next["--popover-bottom"] = `${window.innerHeight - rect.top + 10}px`;
      else next["--popover-top"] = `${rect.bottom + 8}px`;
      if (align === "start") next["--popover-left"] = `${Math.max(12, rect.left)}px`;
      else if (align === "center") next["--popover-left"] = `${rect.left + rect.width / 2}px`;
      else next["--popover-right"] = `${Math.max(12, window.innerWidth - rect.right)}px`;
      setCoordinates(next as React.CSSProperties);
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, { capture: true, passive: true });
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, { capture: true });
    };
  }, [align, open, placement]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      const panel = panelRef.current;
      const first =
        panel?.querySelector<HTMLElement>("[data-autofocus]") ??
        panel?.querySelector<HTMLElement>(
          kind === "menu" ? "[data-menu-item]:not([disabled])" : focusableSelector,
        );
      first?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [kind, open]);

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
      return;
    }

    if (kind !== "menu" || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;
    event.preventDefault();
    const items = [
      ...(panelRef.current?.querySelectorAll<HTMLElement>("[data-menu-item]:not([disabled])") ??
        []),
    ];
    const index = items.indexOf(document.activeElement as HTMLElement);
    const delta = event.key === "ArrowDown" ? 1 : -1;
    items[(index + delta + items.length) % items.length]?.focus();
  }

  return (
    <div className={styles.popoverAnchor}>
      {trigger({
        "aria-controls": panelId,
        "aria-expanded": open,
        "aria-haspopup": kind,
        onClick: () => setOpen(!open),
        ref: triggerRef,
      })}
      {mounted
        ? createPortal(
            <>
              {open ? <div aria-hidden="true" className={styles.popoverScrim} /> : null}
              <div
                aria-label={title}
                className={cx(
                  styles.popover,
                  align === "start" && styles.popoverStart,
                  align === "center" && styles.popoverCenter,
                  placement === "above" && styles.popoverAbove,
                )}
                data-open={open ? "true" : "false"}
                data-reader-chrome-ignore=""
                hidden={!open}
                id={panelId}
                onKeyDown={onKeyDown}
                ref={panelRef}
                role={kind === "menu" ? "menu" : "dialog"}
                style={
                  { ...coordinates, "--popover-width": `${width}px` } as React.CSSProperties
                }
              >
                <div aria-hidden="true" className={styles.sheetGrip} />
                {typeof children === "function" ? children(close) : children}
              </div>
            </>,
            document.body,
          )
        : null}
    </div>
  );
}

export function MenuItem({
  danger = false,
  description,
  disabled,
  icon,
  label,
  onSelect,
}: {
  danger?: boolean;
  description?: string | undefined;
  disabled?: boolean | undefined;
  icon?: IconName | undefined;
  label: string;
  onSelect: () => void;
}) {
  return (
    <button
      className={cx(styles.menuItem, danger && styles.menuItemDanger)}
      data-menu-item=""
      disabled={disabled}
      onClick={onSelect}
      role="menuitem"
      type="button"
    >
      {icon ? <Icon name={icon} size={18} /> : <span aria-hidden="true" />}
      <span className={styles.menuItemText}>
        <span>{label}</span>
        {description ? <small>{description}</small> : null}
      </span>
    </button>
  );
}

export function MenuSeparator() {
  return <hr className={styles.menuSeparator} />;
}

/* ---- Hoja lateral ---------------------------------------------------------- */

/**
 * Panel que entra por un lado de la pantalla —o desde abajo en móvil—.
 *
 * `modal` decide si el resto de la app queda detrás de un velo. El panel del lector no lo
 * es en escritorio: se lee con él abierto, igual que el índice lateral de un lector de
 * libros. La hoja de fuentes de la Biblioteca sí, porque es un sitio al que se va a hacer
 * algo y del que se vuelve.
 */
export function Sheet({
  children,
  description,
  footer,
  modal = true,
  onClose,
  open,
  side = "end",
  title,
  width = 420,
}: {
  children: ReactNode;
  description?: string;
  footer?: ReactNode;
  modal?: boolean;
  onClose: () => void;
  open: boolean;
  side?: "start" | "end";
  title: string;
  width?: number;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useStableId("sheet-title");

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    const frame = window.requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLElement>("[data-sheet-close]")?.focus();
    });

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        onClose();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      // Devolver el foco a quien abrió la hoja: sin esto, el teclado aparece en el
      // principio de la página cada vez que se cierra.
      const target = returnFocusRef.current;
      if (target && document.contains(target)) target.focus();
    };
  }, [onClose, open]);

  function trapFocus(event: React.KeyboardEvent<HTMLElement>) {
    if (!modal || event.key !== "Tab") return;
    const items = [...(panelRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])];
    const first = items[0];
    const last = items.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <>
      <div
        aria-hidden="true"
        className={cx(styles.sheetScrim, !modal && styles.sheetScrimMobileOnly)}
        data-open={open ? "true" : "false"}
        onClick={onClose}
      />
      <aside
        aria-labelledby={titleId}
        aria-modal={modal ? true : undefined}
        className={cx(styles.sheet, side === "start" && styles.sheetStart)}
        data-open={open ? "true" : "false"}
        inert={!open}
        onKeyDown={trapFocus}
        ref={panelRef}
        role="dialog"
        style={{ "--sheet-width": `${width}px` } as React.CSSProperties}
      >
        <div aria-hidden="true" className={styles.sheetGrip} />
        <header className={styles.sheetHeader}>
          <div>
            <h2 id={titleId}>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          <button
            aria-label="Cerrar"
            className={styles.iconButton}
            data-sheet-close=""
            onClick={onClose}
            type="button"
          >
            <Icon name="close" />
          </button>
        </header>
        <div className={styles.sheetBody}>{children}</div>
        {footer ? <footer className={styles.sheetFooter}>{footer}</footer> : null}
      </aside>
    </>
  );
}

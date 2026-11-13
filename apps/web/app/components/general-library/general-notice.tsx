"use client";

import Link from "next/link";
import { useSyncExternalStore, type MouseEvent } from "react";

import { buttonClassName, cx } from "@pliegue/ui";

import {
  generalNotices,
  localDay,
  noticeDateLabel,
  noticeToShow,
  type GeneralNotice,
} from "../../library/general-library-notices";
import { IconButton } from "../app-ui/controls";
import { BrandMark } from "../brand/brand-mark";
import styles from "./general-library.module.css";

/** Los avisos que este navegador ocultó, por id. Solo aquí: no se sincroniza con nada. */
const storageKey = "pliegue-general-avisos-ocultos";
const changeEvent = "pliegue-general-avisos-change";

let cachedSerialized: string | null | undefined;
let cachedHidden: ReadonlySet<string> = new Set();

function readHidden(): ReadonlySet<string> {
  let serialized: string | null = null;
  try {
    serialized = window.localStorage.getItem(storageKey);
  } catch {
    // Sin almacenamiento, lo ocultado en esta visita (abajo) es lo único que hay.
    return cachedHidden;
  }
  if (serialized === cachedSerialized) return cachedHidden;
  cachedSerialized = serialized;
  try {
    const parsed: unknown = serialized ? JSON.parse(serialized) : [];
    cachedHidden = new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : []);
  } catch {
    cachedHidden = new Set();
  }
  return cachedHidden;
}

function subscribe(onStoreChange: () => void) {
  function handleStorage(event: StorageEvent) {
    if (event.key !== storageKey) return;
    cachedSerialized = undefined;
    onStoreChange();
  }
  window.addEventListener(changeEvent, onStoreChange);
  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener(changeEvent, onStoreChange);
    window.removeEventListener("storage", handleStorage);
  };
}

function writeHidden(next: readonly string[]) {
  cachedHidden = new Set(next);
  try {
    const serialized = JSON.stringify(next);
    window.localStorage.setItem(storageKey, serialized);
    cachedSerialized = serialized;
  } catch {
    // Sin almacenamiento, vale hasta recargar.
  }
  window.dispatchEvent(new Event(changeEvent));
}

function hide(id: string) {
  writeHidden([...readHidden(), id]);
}

/** Vuelve a mostrar esos avisos en este navegador: para el catálogo y las pruebas. */
export function showNoticesAgain(ids: readonly string[]) {
  writeHidden([...readHidden()].filter((id) => !ids.includes(id)));
}

/** En el servidor no se sabe qué ocultó el visitante: no se pinta nada hasta estar en su navegador. */
const serverSnapshot = () => null;

/**
 * La tarjeta de avisos de la biblioteca general (03.13d): invita a usar Pliegue con los libros
 * propios y cuenta las novedades. Una esquina doblada, como un pliego: es de Pliegue, no un libro.
 * «Ocultar» la quita en este navegador; la siguiente novedad vuelve a aparecer.
 */
export function GeneralNoticeCard({
  notices = generalNotices,
  onHidden,
}: {
  notices?: readonly GeneralNotice[];
  /** Tras ocultarla con el teclado, adónde va el foco: el botón ya no existe. */
  onHidden?: () => void;
}) {
  const hidden = useSyncExternalStore<ReadonlySet<string> | null>(subscribe, readHidden, serverSnapshot);
  if (!hidden) return null;
  const today = localDay(new Date());
  const notice = noticeToShow(notices, hidden, today);
  if (!notice) return null;

  const titleId = `aviso-${notice.id}`;
  function dismiss(event: MouseEvent<HTMLButtonElement>) {
    hide(notice!.id);
    // `detail` 0: se pulsó con el teclado. Con el dedo no se mueve el foco (abriría el teclado).
    if (event.detail === 0) onHidden?.();
  }

  const close = <IconButton className={styles.bulletinClose} icon="close" label="Ocultar este aviso" onClick={dismiss} size="sm" />;

  if (notice.banner) {
    const { alt, desktop, mobile } = notice.banner;
    // Una imagen para el móvil y otra para el escritorio (art direction): el texto va dentro, y
    // con la de escritorio encogida a un móvil no se leería. Son WebP ya a su tamaño.
    const picture = (
      <picture>
        <source height={mobile.height} media="(max-width: 899px)" srcSet={mobile.src} width={mobile.width} />
        <img alt={alt} decoding="async" height={desktop.height} src={desktop.src} width={desktop.width} />
      </picture>
    );
    return (
      <aside aria-label={notice.title} className={styles.bulletinBanner} data-kind={notice.kind}>
        {notice.action ? (
          <Link className={styles.bulletinBannerLink} href={notice.action.href}>
            {picture}
          </Link>
        ) : (
          picture
        )}
        {close}
      </aside>
    );
  }

  return (
    <aside aria-labelledby={titleId} className={styles.bulletin} data-kind={notice.kind}>
      <BrandMark className={cx(styles.bulletinMark)} size={44} />
      <div className={styles.bulletinBody}>
        <h2 id={titleId}>{notice.title}</h2>
        <p>{notice.text}</p>
        {notice.action || notice.more || notice.kind === "novedad" ? (
          <div className={styles.bulletinActions}>
            {notice.action ? (
              <Link className={buttonClassName({ size: "sm", variant: "primary" })} href={notice.action.href}>
                {notice.action.label}
              </Link>
            ) : null}
            {notice.more ? (
              <Link className={buttonClassName({ size: "sm", variant: "quiet" })} href={notice.more.href}>
                {notice.more.label}
              </Link>
            ) : null}
            {notice.kind === "novedad" ? <time dateTime={notice.date}>{noticeDateLabel(notice.date, today)}</time> : null}
          </div>
        ) : null}
      </div>
      {close}
    </aside>
  );
}

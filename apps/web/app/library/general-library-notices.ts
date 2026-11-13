/**
 * Los avisos de la biblioteca general (03.13d): una tarjeta bajo la cabecera que invita a usar
 * Pliegue con los libros propios y que también sirve para contar novedades. Quien entra con un
 * código lee los libros del dueño, y hasta ahora nada le decía que podía hacer lo mismo con los
 * suyos.
 *
 * **Publicar una novedad** es añadir un aviso a `generalNotices` y desplegar:
 * - `id` único y estable: es lo que recuerda el navegador de quien lo oculta. No se reutiliza.
 * - `date` (AAAA-MM-DD): se muestra el más reciente; en una novedad, además, se ve la fecha.
 * - `until` (opcional, incluido): a partir del día siguiente deja de mostrarse.
 * - `action` y `more` (opcionales): un enlace principal y otro discreto.
 *
 * Se muestra uno a la vez: la novedad más reciente que siga vigente y no se haya ocultado y, si no
 * queda ninguna, la invitación. Ocultar una novedad deja ver la siguiente o la invitación; una
 * novedad nueva vuelve a aparecer aunque se ocultara todo.
 */

export interface GeneralNoticeLink {
  href: string;
  label: string;
}

export interface GeneralNotice {
  action?: GeneralNoticeLink;
  /** Fecha de publicación, AAAA-MM-DD. */
  date: string;
  id: string;
  /** `pliegue`: la invitación a usar la app, sin fecha a la vista. `novedad`: lleva su fecha. */
  kind: "novedad" | "pliegue";
  more?: GeneralNoticeLink;
  text: string;
  title: string;
  /** Último día en que se muestra, AAAA-MM-DD. Sin él, no caduca. */
  until?: string;
}

export const generalNotices: readonly GeneralNotice[] = [
  {
    action: { href: "/app", label: "Empezar con mis libros" },
    date: "2026-11-12",
    id: "pliegue-con-tus-libros",
    kind: "pliegue",
    more: { href: "/", label: "Qué es Pliegue" },
    text:
      "Esta biblioteca se lee con Pliegue. Úsalo también con los tuyos, los de tu equipo o tu Drive: los ordena, los abre en un lector cuidado, los traduce y te contesta citándolos. Es gratis, y tus archivos no se suben a ningún sitio.",
    title: "Haz lo mismo con tus libros",
  },
];

/** El día de hoy en la hora del visitante, AAAA-MM-DD: con él se comparan `date` y `until`. */
export function localDay(now: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** El aviso que toca mostrar, o `null` si no queda ninguno. */
export function noticeToShow(notices: readonly GeneralNotice[], hidden: ReadonlySet<string>, today: string) {
  const rank = (notice: GeneralNotice) => (notice.kind === "novedad" ? 0 : 1);
  return (
    notices
      // Uno con fecha futura espera a su día; uno caducado ya no sale.
      .filter((notice) => !hidden.has(notice.id) && notice.date <= today && (!notice.until || today <= notice.until))
      // Una novedad vigente va antes que la invitación, que es lo que queda de fondo.
      .sort((left, right) => rank(left) - rank(right) || right.date.localeCompare(left.date))[0] ?? null
  );
}

/** «12 de noviembre», o con el año si no es el de hoy. */
export function noticeDateLabel(date: string, today: string) {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const options: Intl.DateTimeFormatOptions = { day: "numeric", month: "long" };
  if (date.slice(0, 4) !== today.slice(0, 4)) options.year = "numeric";
  return new Date(year, month - 1, day).toLocaleDateString("es", options);
}

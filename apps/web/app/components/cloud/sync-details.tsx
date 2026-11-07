"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@pliegue/ui";

import { collectionNames, describeActivity, syncedPercent } from "../../cloud/sync/sync-activity";
import { restoreConflict, type SyncStatus } from "../../cloud/sync/sync-controller";
import { useSyncConflicts, type StoredConflict } from "../../cloud/sync/sync-history";
import { sloSeconds } from "../../cloud/sync/sync-latency";
import { useDriveConnection } from "../../drive/drive-connection";
import { useDriveLibrary } from "../../library/drive-library-store";
import styles from "./account-panel.module.css";

/**
 * Qué decir junto a Google Drive cuando no aporta libros. Depende de la conexión, no del
 * número: con Drive conectado y nada elegido todavía, ofrecer «Conectar» confundía.
 */
function driveHint(configured: boolean, linked: boolean, count: number) {
  if (count > 0) return null;
  if (!configured) return { href: null, text: "No está disponible en esta instalación." };
  if (linked) return { href: "/app/biblioteca/fuentes#drive", text: "Conectado, sin libros todavía: elige archivos o una carpeta" };
  return { href: "/app/biblioteca/fuentes#drive", text: "Conectar Google Drive" };
}

/** Orden de la tabla: de lo que la persona hace a diario a los ajustes. */
const collectionOrder = [
  "favorites",
  "reading-progress",
  "annotations",
  "catalog-import",
  "catalog-ai",
  "book-translation",
  "translation-files",
  "settings",
];

const originNames: Record<keyof NonNullable<SyncStatus["books"]>["byOrigin"], string> = {
  "google-drive": "Google Drive",
  "local-copy": "Copias importadas",
  "local-file": "Archivos sueltos",
  "local-folder": "Carpetas de este equipo",
};
const originOrder = ["local-folder", "google-drive", "local-file", "local-copy"];

const number = (value: number) => value.toLocaleString("es");

/** Cuántos libros de otros equipos se nombran; el resto se cuenta. */
const maxNamedElsewhere = 12;

function clock(iso: string) {
  return new Date(iso).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Ajustes → Cuenta, con la sincronización activa: qué hay en la cuenta frente a este equipo,
 * cuánto está al día, de dónde salen los libros y qué hicieron las últimas vueltas. Los datos
 * son los de la última vuelta: no consultan la nube por su cuenta.
 */
export function SyncDetails({ status, userId }: { status: SyncStatus; userId: string }) {
  const { activity, books, summary, unsynced } = status;
  const percent = syncedPercent(summary, unsynced);
  const drive = useDriveConnection();
  const driveLibrary = useDriveLibrary();
  const driveLinked = drive.authorized || driveLibrary.sources.length > 0 || driveLibrary.documents.length > 0;
  const files = books ? Object.values(books.byOrigin).reduce((sum, count) => sum + count, 0) : 0;
  // La carpeta local y Google Drive se muestran siempre, aunque estén vacíos: es lo que la
  // persona busca. Los archivos sueltos y las copias importadas, solo si los hay.
  const origins = books
    ? (Object.entries(books.byOrigin) as Array<[keyof typeof originNames, number]>)
        .filter(([origin, count]) => count > 0 || origin === "local-folder" || origin === "google-drive")
        .sort(([left], [right]) => originOrder.indexOf(left) - originOrder.indexOf(right))
        .map(([origin, count]) => ({ count, label: originNames[origin], origin }))
    : [];

  return (
    <div className={styles.details}>
      <section aria-labelledby="sync-account-title" className={styles.detailBlock}>
        <h3 id="sync-account-title">Lo que hay en tu cuenta</h3>
        {summary ? (
          <>
            <table className={styles.counts}>
              <thead>
                <tr>
                  <th scope="col">
                    <span className={styles.visuallyHidden}>Qué</span>
                  </th>
                  <th scope="col">En la nube</th>
                  <th scope="col">En este equipo</th>
                </tr>
              </thead>
              <tbody>
                {collectionOrder.map((name) => {
                  const counts = summary.collections[name];
                  if (!counts) return null;
                  return (
                    <tr data-disabled={counts.disabled || undefined} key={name}>
                      <th scope="row">
                        {collectionNames[name]?.label ?? name}
                        {counts.disabled ? (
                          <small>No se sincronizan: no diste permiso.</small>
                        ) : counts.waiting ? (
                          <small>
                            {number(counts.waiting)} {counts.waiting === 1 ? "espera" : "esperan"} su libro en este equipo
                          </small>
                        ) : null}
                      </th>
                      <td>{counts.disabled ? "—" : number(counts.cloud)}</td>
                      <td>{number(counts.local)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className={styles.upToDate} data-complete={percent === 100 || undefined} role="status">
              {percent === 100
                ? "Todo lo de este equipo está en la nube · 100\u00a0%"
                : `${number(unsynced)} ${unsynced === 1 ? "cambio" : "cambios"} de este equipo sin subir · ${percent ?? 0}\u00a0% en la nube. Se subirán en la próxima vuelta.`}
            </p>
          </>
        ) : (
          <p className={styles.note}>El recuento aparece cuando termina la primera vuelta de esta sesión.</p>
        )}
      </section>

      {books ? (
        <section aria-labelledby="sync-books-title" className={styles.detailBlock}>
          <h3 id="sync-books-title">Tus libros</h3>
          <p className={styles.booksLine}>
            <strong>{number(books.distinct)}</strong> {books.distinct === 1 ? "libro" : "libros"} en este equipo
            {files !== books.distinct ? ` (${number(files)} archivos contando las copias)` : ""}
          </p>
          <ul className={styles.origins}>
            {origins.map(({ count, label, origin }) => {
              const hint = origin === "google-drive" ? driveHint(drive.configured, driveLinked, count) : null;
              return (
                <li key={origin}>
                  <span>{label}</span>
                  <strong>{number(count)}</strong>
                  {hint?.href ? <Link href={hint.href}>{hint.text}</Link> : hint ? <small>{hint.text}</small> : null}
                </li>
              );
            })}
          </ul>
          {books.inBoth ? (
            <p className={styles.booksLine}>
              {number(books.inBoth)} {books.inBoth === 1 ? "está" : "están"} en local y en Google Drive a la vez:{" "}
              {books.inBoth === 1 ? "es el mismo libro y comparte" : "son el mismo libro y comparten"} avance y notas.
            </p>
          ) : null}
          <p className={styles.note}>
            {summary ? `${number(summary.booksWithState)} con avance, notas, favorito o ficha guardados en tu cuenta. ` : ""}
            Los libros no se suben, vengan de tu carpeta o de Google Drive: viaja lo que haces con ellos, y cada
            equipo los reconoce por su nombre y su tamaño.
            {books.inBoth ? "" : " El mismo libro en local y en Drive comparte avance y notas."}
          </p>
        </section>
      ) : null}

      {summary?.elsewhere.total ? <BooksElsewhere summary={summary} /> : null}

      <SyncSpeed latency={status.latency} />
      <ConflictHistory userId={userId} />

      {activity.length ? (
        <section aria-labelledby="sync-activity-title" className={styles.detailBlock}>
          <h3 id="sync-activity-title">Actividad</h3>
          <ol className={styles.activity}>
            {activity.map((entry) => (
              <li data-kind={entry.kind} key={`${entry.since ?? entry.at}-${entry.kind}`}>
                <time dateTime={entry.at}>{clock(entry.at)}</time>
                <span>
                  {describeActivity(entry)}
                  {entry.since && entry.checks && entry.checks > 1 ? ` desde las ${clock(entry.since)}` : ""}
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}

/**
 * Libros con algo guardado en la cuenta que no están en este equipo (06.3). Se nombran por su
 * ficha sincronizada; los que no la tienen solo se cuentan, porque de ellos la nube guarda la
 * huella del archivo y no su nombre.
 */
function BooksElsewhere({ summary }: { summary: NonNullable<SyncStatus["summary"]> }) {
  const { named, total } = summary.elsewhere;
  const shown = named.slice(0, maxNamedElsewhere);
  const more = shown.length && total > shown.length ? `Y ${number(total - shown.length)} más. ` : "";
  const unnamed = total - named.length;
  const unnamedNote = !unnamed
    ? ""
    : summary.collections["catalog-ai"]?.disabled
      ? "Aquí no aceptaste las fichas hechas por la IA: con ellas verías el título de los que tengan ficha."
      : `${number(unnamed)} sin título: no ${unnamed === 1 ? "tiene" : "tienen"} ficha en tu cuenta.`;
  return (
    <section aria-labelledby="sync-elsewhere-title" className={styles.detailBlock}>
      <h3 id="sync-elsewhere-title">En tus otros equipos</h3>
      <p className={styles.booksLine}>
        <strong>{number(total)}</strong> {total === 1 ? "libro tiene" : "libros tienen"} avance, notas, favorito o ficha en
        tu cuenta y no {total === 1 ? "está" : "están"} en este equipo.
      </p>
      {shown.length ? (
        <ul aria-label="Libros de tus otros equipos" className={styles.elsewhere}>
          {shown.map((book) => (
            <li key={book.key}>
              <cite>{book.title}</cite>
              {book.authors.length ? <small>{book.authors.join(", ")}</small> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {more || unnamedNote ? (
        <p className={styles.note}>
          {more}
          {unnamedNote}
        </p>
      ) : null}
      <p className={styles.note}>
        Si añades aquí el mismo archivo (mismo nombre y tamaño), recupera lo que tenía guardado.
      </p>
    </section>
  );
}

const seconds = (value: number) => `${value.toLocaleString("es", { maximumFractionDigits: 1 })}\u00a0s`;

/** Cuánto tarda un cambio en llegar a otro equipo (06.3, objetivo: 60 s en el p95). */
function SyncSpeed({ latency }: { latency: SyncStatus["latency"] }) {
  return (
    <section aria-labelledby="sync-speed-title" className={styles.detailBlock}>
      <h3 id="sync-speed-title">Rapidez</h3>
      {latency?.total !== null && latency?.total !== undefined ? (
        <p className={styles.booksLine} data-ok={latency.total <= sloSeconds || undefined} role="status">
          Un cambio llega a tus otros equipos en unos <strong>{seconds(latency.total)}</strong> (p95: subir{" "}
          {seconds(latency.up ?? 0)} y bajar {seconds(latency.down ?? 0)}). Objetivo: {sloSeconds}&nbsp;s
          {latency.total <= sloSeconds ? ", cumplido." : ": no se cumple."}
        </p>
      ) : (
        <p className={styles.note}>
          Aún sin medidas suficientes
          {latency ? ` (subir: ${latency.samples.up}, bajar: ${latency.samples.down})` : ""}. Se miden los cambios que viajan
          mientras tus equipos están abiertos y con conexión.
        </p>
      )}
      {latency?.total !== null && latency ? (
        <p className={styles.note}>
          Con {latency.samples.up} {latency.samples.up === 1 ? "subida" : "subidas"} y {latency.samples.down}{" "}
          {latency.samples.down === 1 ? "bajada" : "bajadas"} medidas en este equipo.
        </p>
      ) : null}
    </section>
  );
}

/** Qué ajuste es cada uno de los que se sincronizan. */
const settingNames: Record<string, string> = {
  ai: "Ajustes de IA",
  "postcard-design": "Diseño de las postales",
  preferences: "Preferencias de lectura",
  "reader-view": "Vista del lector",
};

function ago(iso: string) {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "hace un momento";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return new Date(iso).toLocaleDateString("es", { day: "numeric", month: "short" });
}

/**
 * Conflictos recientes (06.3): cuando dos equipos cambiaron lo mismo, uno ganó. Aquí está la
 * versión que perdió, y se puede recuperar.
 */
function ConflictHistory({ userId }: { userId: string }) {
  const conflicts = useSyncConflicts(userId);
  const [message, setMessage] = useState<string | null>(null);
  if (!conflicts.length) return null;
  const shown = conflicts.slice(0, 10);

  async function restore(conflict: StoredConflict) {
    const done = await restoreConflict(userId, conflict.id);
    setMessage(done ? "Restaurada: se subirá en la próxima vuelta y llegará a tus otros equipos." : "No se pudo restaurar ahora. Vuelve a intentarlo.");
  }

  return (
    <section aria-labelledby="sync-conflicts-title" className={styles.detailBlock}>
      <h3 id="sync-conflicts-title">Conflictos recientes</h3>
      <p className={styles.note}>
        Cuando dos equipos cambian lo mismo antes de sincronizarse, se queda el último cambio. La otra versión se guarda
        aquí 30 días, por si era la buena.
      </p>
      <ol className={styles.conflicts}>
        {shown.map((conflict) => {
          const name = collectionNames[conflict.collection]?.one ?? conflict.collection;
          const what =
            conflict.collection === "settings"
              ? (settingNames[conflict.key] ?? "Ajustes")
              : `${name[0]?.toUpperCase() ?? ""}${name.slice(1)}${conflict.title ? ` de «${conflict.title}»` : ""}`;
          return (
            <li key={conflict.id}>
              <div>
                <strong>{what}</strong>
                <small>
                  {conflict.lost === "local" ? "Se quedó la de otro equipo" : "Este equipo pisó la de otro"} · {ago(conflict.at)}
                </small>
                <span className={styles.conflictLoser}>
                  {conflict.loser.deleted
                    ? "La otra versión era un borrado."
                    : conflict.preview
                      ? `La otra versión: ${conflict.preview}`
                      : `La otra versión, del ${new Date(conflict.loser.updatedAt).toLocaleString("es", { day: "numeric", hour: "2-digit", minute: "2-digit", month: "short" })}.`}
                </span>
              </div>
              {conflict.restoredAt ? (
                <small>Restaurada</small>
              ) : (
                <Button onClick={() => void restore(conflict)} size="sm" type="button" variant="secondary">
                  {conflict.loser.deleted ? "Restaurar el borrado" : "Restaurar esta versión"}
                </Button>
              )}
            </li>
          );
        })}
      </ol>
      {message ? (
        <p className={styles.note} role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}

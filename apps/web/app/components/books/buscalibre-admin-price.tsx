"use client";

import { useEffect, useState, type ReactNode } from "react";

import { Button } from "@pliegue/ui";

import { formatPrice, type BookStore } from "../../library/book-stores";
import { buildBuscalibreIndex, lookupBuscalibrePrice, useBuscalibreIndex, type BuscalibrePriceResult } from "../../library/buscalibre-index-store";
import { toIsbn13 } from "../../library/buscalibre-prices";
import { Icon } from "../app-ui/icons";
import styles from "./book-offers.module.css";

/**
 * El precio de Buscalibre dentro de «Dónde conseguirlo», **solo para el admin** (06.2b). Quien
 * lo monta (`BookOffers`) ya comprobó que la cuenta es admin, y el servidor lo vuelve a comprobar
 * en cada consulta. Para encontrar la ficha hace falta la lista ISBN → producto de Buscalibre,
 * que se prepara una vez y se guarda solo en este navegador.
 */

const when = new Intl.DateTimeFormat("es", { day: "numeric", hour: "2-digit", minute: "2-digit", month: "short", year: "numeric" });
const day = new Intl.DateTimeFormat("es", { day: "numeric", month: "short", year: "numeric" });
const count = new Intl.NumberFormat("es");

const availabilityLabel = { "in-stock": "Disponible", "out-of-stock": "Agotado", preorder: "Preventa", unknown: "" } as const;

export function BuscalibreAdminPrice({ isbn, store }: { isbn: string | null; store: BookStore }) {
  const index = useBuscalibreIndex();
  const isbn13 = toIsbn13(isbn);
  // Mientras se rehace la lista, la anterior sigue guardada y sirve para buscar.
  const meta = index.status === "ready" || index.status === "building" || index.status === "error" ? index.meta : null;
  const builtAt = meta?.builtAt ?? null;
  const lookupKey = `${store.id}|${isbn13 ?? ""}|${builtAt ?? ""}`;
  const [price, setPrice] = useState<{ key: string; result: BuscalibrePriceResult } | null>(null);

  useEffect(() => {
    if (!isbn13 || !builtAt) return;
    let active = true;
    void lookupBuscalibrePrice(store.id, isbn13).then((result) => {
      if (active) setPrice({ key: lookupKey, result });
    });
    return () => {
      active = false;
    };
  }, [builtAt, isbn13, lookupKey, store.id]);

  const result = price?.key === lookupKey ? price.result : null;
  const building = index.status === "building";

  let body: ReactNode;
  if (!isbn13) {
    body = <p className={styles.note}>Sin ISBN no se puede encontrar su ficha en Buscalibre: usa el enlace de arriba.</p>;
  } else if (index.status === "loading") {
    body = (
      <p className={styles.note} role="status">
        Mirando la lista de Buscalibre de este navegador…
      </p>
    );
  } else if (!meta) {
    body = building ? null : (
      <>
        <p className={styles.note}>
          Para ver el precio aquí hace falta la lista de libros de Buscalibre (unos 850.000 ISBN). Se descarga una vez, tarda alrededor de un
          minuto y se guarda solo en este navegador.
        </p>
        <Button onClick={() => void buildBuscalibreIndex(store.id)} size="sm" variant="secondary">
          Preparar la lista de Buscalibre
        </Button>
      </>
    );
  } else if (!result) {
    body = (
      <p className={styles.note} role="status">
        Consultando el precio en Buscalibre {store.country}…
      </p>
    );
  } else if (result.status === "found") {
    body = (
      <ul className={styles.offers}>
        <li>
          <a href={result.url} rel="noopener noreferrer" target="_blank">
            <strong>{formatPrice(result.price, result.currency, store.id)}</strong>
            <span>
              {[availabilityLabel[result.availability], result.title].filter(Boolean).join(" · ")}
            </span>
          </a>
          <small>
            Buscalibre {store.country} · precio consultado el {when.format(new Date(result.fetchedAt))}
          </small>
        </li>
      </ul>
    );
  } else if (result.status === "not-sold") {
    body = (
      <p className={styles.note}>
        Buscalibre tiene su ficha, pero no lo vende ahora en {store.country} (consultado el {when.format(new Date(result.fetchedAt))}).
      </p>
    );
  } else if (result.status === "not-in-catalog") {
    body = <p className={styles.note}>Ese ISBN no está en la lista de Buscalibre: puede que lo tengan en otra edición. Prueba con el enlace.</p>;
  } else {
    body = (
      <p className={styles.note} role="alert">
        {result.message}
      </p>
    );
  }

  return (
    <div aria-labelledby="offers-admin-price" className={styles.admin} role="group">
      <p className={styles.adminTag} id="offers-admin-price">
        <Icon name="eye" size={14} /> Precio en Buscalibre · solo lo ves tú, como admin
      </p>
      {body}
      {building ? (
        <div className={styles.progress} role="status">
          <progress aria-label="Descarga de la lista de Buscalibre" max={index.total || 1} value={index.done} />
          <span>
            Descargando la lista de Buscalibre{index.total ? `: ${index.done} de ${index.total} partes` : "…"}
          </span>
        </div>
      ) : null}
      {index.status === "error" ? (
        <p className={styles.note} role="alert">
          {index.message}
        </p>
      ) : null}
      {meta || index.status === "error" ? (
        <p className={styles.adminFooter}>
          {meta ? `Lista del ${day.format(new Date(meta.builtAt))} · ${count.format(meta.entries)} libros. ` : ""}
          <Button disabled={building} onClick={() => void buildBuscalibreIndex(store.id)} size="sm" variant="quiet">
            {meta ? "Actualizar la lista" : "Reintentar"}
          </Button>
        </p>
      ) : null}
      <p className={styles.note}>Buscalibre no autoriza reutilizar los datos de su catálogo; por eso este precio no se enseña a nadie más.</p>
    </div>
  );
}

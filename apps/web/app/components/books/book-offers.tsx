"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { Select } from "@pliegue/ui";

import { currentBookStore, lookupDigitalOffers, setBookStore, useBookStore, type DigitalOffersResult } from "../../library/book-offers-store";
import { buscalibreStores, buscalibreUrl, formatPrice, storeById, type BookLookup } from "../../library/book-stores";
import { Icon } from "../app-ui/icons";
import { Sheet } from "../app-ui/overlays";
import styles from "./book-offers.module.css";

/**
 * «Dónde conseguirlo» (06.2): Buscalibre en el país elegido y, si la clave de Google lo permite,
 * los libros digitales de Google Play con su precio y la fecha de la consulta. Se abre desde el
 * menú de un libro o desde una recomendación: `showBookOffers(libro)`.
 */

export interface OffersTarget extends BookLookup {
  /** Cómo se enseña el libro («Ficciones, de Jorge Luis Borges»). */
  label: string;
}

let target: OffersTarget | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export function showBookOffers(book: OffersTarget) {
  target = book;
  emit();
}

function hide() {
  target = null;
  emit();
}

const when = new Intl.DateTimeFormat("es", { day: "numeric", hour: "2-digit", minute: "2-digit", month: "short", year: "numeric" });

export function BookOffersHost() {
  const current = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => target,
    () => null,
  );
  return (
    <Sheet onClose={hide} open={Boolean(current)} title="Dónde conseguirlo" width={420}>
      {current ? <BookOffers book={current} key={`${current.label}|${current.isbn ?? ""}`} /> : null}
    </Sheet>
  );
}

export function BookOffers({ book }: { book: OffersTarget }) {
  const storeId = useBookStore();
  const store = storeById(storeId);
  const [digital, setDigital] = useState<{ key: string; result: DigitalOffersResult } | null>(null);
  const lookupKey = `${storeId}|${book.isbn ?? book.title}`;

  useEffect(() => {
    const country = currentBookStore()?.id;
    if (!country) return;
    let active = true;
    void lookupDigitalOffers(book, country).then((result) => {
      if (active) setDigital({ key: lookupKey, result });
    });
    return () => {
      active = false;
    };
  }, [book, lookupKey]);

  const result = digital?.key === lookupKey ? digital.result : null;

  return (
    <div className={styles.panel}>
      <p className={styles.book}>{book.label}</p>

      <label className={styles.country}>
        <span>País</span>
        <Select onChange={(event) => setBookStore(event.target.value)} value={storeId ?? ""}>
          {storeId ? null : <option value="">Elige tu país</option>}
          {buscalibreStores.map((item) => (
            <option key={item.id} value={item.id}>
              {item.country}
            </option>
          ))}
        </Select>
      </label>

      <section aria-labelledby="offers-print" className={styles.section}>
        <h3 id="offers-print">En papel y digital · Buscalibre</h3>
        {store ? (
          <>
            <a className={styles.storeLink} href={buscalibreUrl(store, book)} rel="noopener noreferrer" target="_blank">
              <span>
                <strong>Buscalibre {store.country}</strong>
                <small>Ver precio, formato, envío y promociones · en {store.currency}</small>
              </span>
              <Icon name="link" size={18} />
            </a>
            <p className={styles.note}>
              Se abre su web, con la búsqueda {book.isbn ? `del ISBN ${book.isbn}` : "por título y autor"}. Buscalibre no ofrece sus
              precios a otras aplicaciones: el precio, el envío y las promociones los ves allí.
            </p>
          </>
        ) : (
          <p className={styles.note}>Elige tu país para ver la tienda de Buscalibre que te corresponde.</p>
        )}
      </section>

      {store ? (
        <section aria-labelledby="offers-digital" aria-busy={!result} className={styles.section}>
          <h3 id="offers-digital">Digital · Google Play Libros</h3>
          {!result ? (
            <p className={styles.note} role="status">
              Consultando precios…
            </p>
          ) : result.status === "unavailable" ? (
            <p className={styles.note}>Los precios de libros digitales no están disponibles ahora.</p>
          ) : result.offers.length ? (
            <ul className={styles.offers}>
              {result.offers.map((offer) => (
                <li key={offer.url}>
                  <a href={offer.url} rel="noopener noreferrer" target="_blank">
                    <strong>{formatPrice(offer.price, offer.currency, offer.country || store.id)}</strong>
                    {offer.listPrice ? <s>{formatPrice(offer.listPrice, offer.currency, offer.country || store.id)}</s> : null}
                    <span>
                      {offer.format} · {offer.title || book.title}
                    </span>
                  </a>
                  <small>
                    {offer.country ? `${store.country} · ` : ""}digital, sin envío · precio consultado el {when.format(new Date(offer.fetchedAt))}
                  </small>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.note}>
              Google Play no lo vende en {store.country} (consultado el {when.format(new Date(result.fetchedAt))}).
            </p>
          )}
        </section>
      ) : null}

      <p className={styles.footer}>
        Pliegue no gana nada con estos enlaces. Para buscarlo, sale de tu equipo el título, el autor o el ISBN y el país; nunca el
        archivo.
      </p>
    </div>
  );
}

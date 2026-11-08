import type { BookStore } from "./book-stores";

/**
 * El precio de Buscalibre, **solo para el admin** (06.2b). Decisión del dueño (8-nov-2026),
 * sabiendo que los términos de Buscalibre prohíben extraer datos de su catálogo para reutilizarlos
 * sin su autorización expresa: por eso nadie más lo ve, y el servidor lo comprueba.
 *
 * Lo que sí se respeta es su `robots.txt`: no se tocan sus búsquedas (ninguna URL con `?`). Se
 * leen solo dos cosas que su robots.txt deja leer:
 * - Los **sitemaps de productos** (`/sitemaps/productos_N.xml`), que son los mismos en todos los
 *   países. Cada URL lleva el ISBN-13 y el número de producto (`/libro-…/<ISBN>/p/<id>`). Con
 *   ellos se arma un índice ISBN → producto que vive **solo en el navegador del admin**.
 * - La **ficha del producto**, cuyo JSON-LD (schema.org Product/Offer) trae el precio, la moneda
 *   y la disponibilidad en la tienda del país.
 *
 * Este módulo no habla con nadie: solo arma las direcciones y lee las respuestas.
 */

/** Quién pregunta: un nombre honesto, con la dirección de Pliegue. */
export const buscalibreUserAgent = "Pliegue/1.0 (+https://pliegue.genaropretill.com)";

/** Tope de partes del sitemap que se aceptan (hoy son 34). */
export const maxSitemapParts = 200;

/** El índice se reparte en 100 grupos según dos cifras del ISBN, para leer solo uno al buscar. */
export const shardCount = 100;

export function sitemapIndexUrl(store: BookStore) {
  return `${store.host}/sitemaps/productos.xml`;
}

export function sitemapPartUrl(store: BookStore, part: number) {
  return `${store.host}/sitemaps/productos_${part}.xml`;
}

/** La ficha del producto. El nombre del libro en la URL da igual: Buscalibre redirige a la buena. */
export function productPageUrl(store: BookStore, isbn: string, productId: string) {
  return `${store.host}/libro-pliegue/${isbn}/p/${productId}`;
}

export const isIsbn13 = (value: string) => /^97[89]\d{10}$/.test(value);
export const isProductId = (value: string) => /^\d{1,12}$/.test(value);

/** El ISBN en 13 cifras: un ISBN-10 se convierte (978 + sus nueve primeras + el dígito de control). */
export function toIsbn13(value: string | null | undefined) {
  const clean = (value ?? "").replace(/[^0-9Xx]/g, "").toUpperCase();
  if (isIsbn13(clean)) return clean;
  if (!/^\d{9}[\dX]$/.test(clean)) return null;
  const body = `978${clean.slice(0, 9)}`;
  const sum = [...body].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0);
  return `${body}${(10 - (sum % 10)) % 10}`;
}

/** Las partes que anuncia el índice del sitemap (`productos_N.xml`), sin repetir y en orden. */
export function parseSitemapIndex(xml: string): number[] {
  const parts = new Set<number>();
  for (const match of xml.matchAll(/\/sitemaps\/productos_(\d{1,3})\.xml\s*</g)) {
    const part = Number(match[1]);
    if (part < maxSitemapParts) parts.add(part);
  }
  return [...parts].sort((left, right) => left - right);
}

/** Los pares «ISBN-13 id» de una parte del sitemap; lo que no es un libro con ISBN-13 se salta. */
export function parseSitemapPart(xml: string): string[] {
  const entries: string[] = [];
  for (const match of xml.matchAll(/<loc>[^<]*?\/(97[89]\d{10})\/p\/(\d{1,12})\s*<\/loc>/g)) entries.push(`${match[1]} ${match[2]}`);
  return entries;
}

export type BuscalibreAvailability = "in-stock" | "out-of-stock" | "preorder" | "unknown";

export interface BuscalibreProduct {
  availability: BuscalibreAvailability;
  /** ISO 4217. */
  currency: string;
  isbn: string;
  price: number;
  title: string;
}

function availabilityOf(value: unknown): BuscalibreAvailability {
  const text = typeof value === "string" ? value : "";
  if (/InStock|InStoreOnly|OnlineOnly|LimitedAvailability/i.test(text)) return "in-stock";
  if (/OutOfStock|SoldOut|Discontinued/i.test(text)) return "out-of-stock";
  if (/PreOrder|PreSale|BackOrder/i.test(text)) return "preorder";
  return "unknown";
}

function typesOf(item: Record<string, unknown>) {
  const type = item["@type"];
  return (Array.isArray(type) ? type : [type]).filter((value): value is string => typeof value === "string");
}

/** Los objetos de un bloque JSON-LD: suelto, en lista o dentro de `@graph`. */
function jsonLdItems(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw.flatMap(jsonLdItems);
  if (!raw || typeof raw !== "object") return [];
  const record = raw as Record<string, unknown>;
  return Array.isArray(record["@graph"]) ? [record, ...jsonLdItems(record["@graph"])] : [record];
}

/**
 * El precio de la ficha, de su JSON-LD: el producto (o libro) con ese ISBN y su primera oferta con
 * precio. Si la ficha es de otro ISBN, o no tiene oferta (no se vende en ese país), devuelve null.
 */
export function parseProductPage(html: string, isbn: string): BuscalibreProduct | null {
  for (const block of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block[1] ?? "");
    } catch {
      continue;
    }
    for (const item of jsonLdItems(parsed)) {
      if (!typesOf(item).some((type) => type === "Product" || type === "Book")) continue;
      const ids = [item.isbn, item.gtin13].filter((value): value is string => typeof value === "string").map((value) => value.replace(/\D/g, ""));
      if (!ids.includes(isbn)) continue;
      const offers = (Array.isArray(item.offers) ? item.offers : [item.offers]) as unknown[];
      for (const raw of offers) {
        const offer = raw as Record<string, unknown> | null;
        if (!offer || typeof offer !== "object") continue;
        const price = typeof offer.price === "number" ? offer.price : Number.parseFloat(String(offer.price ?? ""));
        const currency = typeof offer.priceCurrency === "string" ? offer.priceCurrency.trim().toUpperCase() : "";
        if (!Number.isFinite(price) || price <= 0 || !/^[A-Z]{3}$/.test(currency)) continue;
        return { availability: availabilityOf(offer.availability), currency, isbn, price, title: typeof item.name === "string" ? item.name.trim() : "" };
      }
    }
  }
  return null;
}

/* ---- El índice en grupos ------------------------------------------------------------------------------------- */

/** El grupo de un ISBN-13: sus cifras 11.ª y 12.ª («00»…«99»), que se reparten parejas. */
export function shardOf(isbn: string) {
  return isbn.slice(10, 12);
}

/**
 * Reparte los pares «ISBN id» en sus grupos. Cada grupo es un texto «\nISBN id\nISBN id\n», que
 * ocupa poco y se busca con un `indexOf`. Si un ISBN se repite, gana el primero.
 */
export function groupIntoShards(entries: Iterable<string>): Map<string, string> {
  const groups = new Map<string, string[]>();
  const seen = new Set<string>();
  for (const entry of entries) {
    const isbn = entry.slice(0, 13);
    if (!isIsbn13(isbn) || seen.has(isbn)) continue;
    seen.add(isbn);
    const shard = shardOf(isbn);
    const group = groups.get(shard);
    if (group) group.push(entry);
    else groups.set(shard, [entry]);
  }
  return new Map([...groups].map(([shard, group]) => [shard, `\n${group.join("\n")}\n`]));
}

/** El número de producto de un ISBN dentro de su grupo, o null. */
export function findInShard(shard: string, isbn: string) {
  const start = shard.indexOf(`\n${isbn} `);
  if (start < 0) return null;
  const from = start + isbn.length + 2;
  const id = shard.slice(from, shard.indexOf("\n", from));
  return isProductId(id) ? id : null;
}

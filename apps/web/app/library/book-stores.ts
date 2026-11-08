/**
 * Dónde conseguir un libro (06.2). Dos fuentes, las dos permitidas:
 *
 * - **Buscalibre**, un enlace a la búsqueda del libro en la tienda del país, por ISBN o por título
 *   y autor. Buscalibre no tiene API pública, su `robots.txt` veta sus búsquedas y sus términos
 *   prohíben reutilizar los datos de su catálogo sin autorización, así que para todos el precio,
 *   el formato, el envío y las promociones se ven en su web. La excepción es el admin, que por
 *   decisión del dueño ve el precio dentro de Pliegue (06.2b, `buscalibre-prices.ts`). El enlace
 *   no lleva código de afiliado: Pliegue no gana nada.
 * - **Google Play Libros**, por la Books API de Google (`saleInfo`): precio, moneda, país y
 *   formato de los libros digitales, con la fecha de la consulta. Necesita la clave pública de
 *   Google de Pliegue con la Books API activada; sin ella, esa parte no aparece.
 *
 * Lo que sale del equipo es el título, el autor, el ISBN y el país; nunca el archivo.
 */

export interface BookStore {
  /** Nombre del país, como se enseña. */
  country: string;
  /** Moneda en la que vende esa tienda (ISO 4217). */
  currency: string;
  host: string;
  /** Código del país (ISO 3166-1), en minúsculas. */
  id: string;
}

export const buscalibreStores: readonly BookStore[] = [
  { country: "Perú", currency: "PEN", host: "https://www.buscalibre.pe", id: "pe" },
  { country: "Colombia", currency: "COP", host: "https://www.buscalibre.com.co", id: "co" },
  { country: "Chile", currency: "CLP", host: "https://www.buscalibre.cl", id: "cl" },
  { country: "México", currency: "MXN", host: "https://www.buscalibre.com.mx", id: "mx" },
  { country: "Argentina", currency: "ARS", host: "https://www.buscalibre.com.ar", id: "ar" },
  { country: "Estados Unidos y Puerto Rico", currency: "USD", host: "https://www.buscalibre.us", id: "us" },
];

export function storeById(id: string | null | undefined) {
  return buscalibreStores.find((store) => store.id === id) ?? null;
}

/** La tienda del país del navegador («es-PE» → Perú); null si ninguna encaja. */
export function storeFromLanguages(languages: readonly string[]) {
  for (const language of languages) {
    const region = language.split(/[-_]/)[1]?.toLowerCase();
    if (region === "pr") return storeById("us");
    const store = storeById(region);
    if (store) return store;
  }
  return null;
}

export interface BookLookup {
  authors: readonly string[];
  isbn: string | null;
  title: string;
}

/** Lo que se busca: el ISBN, que da la edición exacta, o el título con el primer autor. */
export function bookSearchText(book: BookLookup) {
  if (book.isbn) return book.isbn;
  return [book.title, book.authors[0] ?? ""].join(" ").replace(/\s+/g, " ").trim();
}

export function buscalibreUrl(store: BookStore, book: BookLookup) {
  return `${store.host}/libros/search?q=${encodeURIComponent(bookSearchText(book))}`;
}

/* ---- Google Play Libros (Books API) -------------------------------------------------------------- */

export const googleBooksBase = "https://www.googleapis.com/books/v1/volumes";

/** La consulta a la Books API: por ISBN o por título y autor. */
export function googleBooksQuery(book: BookLookup) {
  if (book.isbn) return `isbn:${book.isbn}`;
  const author = book.authors[0];
  return [`intitle:"${book.title.replaceAll('"', "")}"`, author ? `inauthor:"${author.replaceAll('"', "")}"` : ""].filter(Boolean).join(" ");
}

export function googleBooksUrl(book: BookLookup, country: string, apiKey: string) {
  const query = new URLSearchParams({
    country: country.toUpperCase(),
    fields: "items(id,volumeInfo(title,authors,language,industryIdentifiers),saleInfo(country,saleability,isEbook,listPrice,retailPrice,buyLink))",
    key: apiKey,
    maxResults: "5",
    q: googleBooksQuery(book),
  });
  return `${googleBooksBase}?${query}`;
}

export interface DigitalOffer {
  /** País de la oferta (ISO 3166-1, mayúsculas). */
  country: string;
  currency: string;
  format: "eBook";
  /** Precio de venta; si hay rebaja, `listPrice` es el de antes. */
  price: number;
  listPrice: number | null;
  /** Cuándo se consultó (ISO 8601). */
  fetchedAt: string;
  store: "Google Play Libros";
  title: string;
  url: string;
}

function money(value: unknown) {
  const record = value as { amount?: unknown; currencyCode?: unknown } | null;
  return record && typeof record.amount === "number" && typeof record.currencyCode === "string" ? { amount: record.amount, currency: record.currencyCode } : null;
}

/** Las ofertas en venta de la respuesta de la Books API: las que tienen precio y enlace. */
export function parseGoogleOffers(raw: unknown, fetchedAt: string): DigitalOffer[] {
  const items = (raw as { items?: unknown[] } | null)?.items;
  if (!Array.isArray(items)) return [];
  const offers: DigitalOffer[] = [];
  for (const item of items) {
    const sale = (item as { saleInfo?: Record<string, unknown> }).saleInfo;
    const info = (item as { volumeInfo?: { title?: unknown } }).volumeInfo;
    if (!sale || sale.saleability !== "FOR_SALE" || typeof sale.buyLink !== "string" || !sale.buyLink.startsWith("https://")) continue;
    const retail = money(sale.retailPrice) ?? money(sale.listPrice);
    if (!retail) continue;
    const list = money(sale.listPrice);
    offers.push({
      country: typeof sale.country === "string" ? sale.country : "",
      currency: retail.currency,
      fetchedAt,
      format: "eBook",
      listPrice: list && list.currency === retail.currency && list.amount > retail.amount ? list.amount : null,
      price: retail.amount,
      store: "Google Play Libros",
      title: typeof info?.title === "string" ? info.title : "",
      url: sale.buyLink,
    });
  }
  // La más barata primero; sin repetir el mismo enlace.
  const seen = new Set<string>();
  return offers.sort((left, right) => left.price - right.price).filter((offer) => !seen.has(offer.url) && seen.add(offer.url));
}

/** «S/ 35,90», «$ 25.900»: el precio en la moneda y con el formato del país. */
export function formatPrice(amount: number, currency: string, country: string) {
  try {
    return new Intl.NumberFormat(`es-${country.toUpperCase()}`, { currency, style: "currency" }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

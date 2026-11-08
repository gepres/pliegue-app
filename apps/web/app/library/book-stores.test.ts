import { describe, expect, it } from "vitest";

import {
  buscalibreUrl,
  formatPrice,
  googleBooksQuery,
  googleBooksUrl,
  parseGoogleOffers,
  storeById,
  storeFromLanguages,
} from "./book-stores";

const ficciones = { authors: ["Jorge Luis Borges"], isbn: null, title: "Ficciones" };

describe("dónde conseguir un libro (06.2)", () => {
  it("elige la tienda de Buscalibre por el país del navegador", () => {
    expect(storeFromLanguages(["es-PE", "es"])?.host).toBe("https://www.buscalibre.pe");
    expect(storeFromLanguages(["es", "es-CO"])?.id).toBe("co");
    expect(storeFromLanguages(["en-US"])?.id).toBe("us");
    expect(storeFromLanguages(["es-PR"])?.id).toBe("us");
    expect(storeFromLanguages(["es-ES", "es"])).toBeNull();
  });

  it("enlaza la búsqueda por ISBN, o por título y primer autor", () => {
    const peru = storeById("pe")!;
    expect(buscalibreUrl(peru, { ...ficciones, isbn: "9788466338141" })).toBe("https://www.buscalibre.pe/libros/search?q=9788466338141");
    expect(buscalibreUrl(storeById("cl")!, ficciones)).toBe("https://www.buscalibre.cl/libros/search?q=Ficciones%20Jorge%20Luis%20Borges");
  });

  it("pregunta a Google Books por ISBN o por título y autor, en el país elegido", () => {
    expect(googleBooksQuery({ ...ficciones, isbn: "9788466338141" })).toBe("isbn:9788466338141");
    expect(googleBooksQuery(ficciones)).toBe('intitle:"Ficciones" inauthor:"Jorge Luis Borges"');
    const url = new URL(googleBooksUrl(ficciones, "pe", "clave"));
    expect(url.searchParams.get("country")).toBe("PE");
    expect(url.searchParams.get("key")).toBe("clave");
  });

  it("se queda con lo que está en venta, con precio, moneda, país, rebaja y fecha", () => {
    const offers = parseGoogleOffers(
      {
        items: [
          { saleInfo: { buyLink: "https://play.google.com/b", country: "PE", isEbook: true, listPrice: { amount: 45, currencyCode: "PEN" }, retailPrice: { amount: 35.9, currencyCode: "PEN" }, saleability: "FOR_SALE" }, volumeInfo: { title: "Ficciones" } },
          { saleInfo: { country: "PE", saleability: "NOT_FOR_SALE" }, volumeInfo: { title: "Ficciones" } },
          { saleInfo: { buyLink: "https://play.google.com/a", country: "PE", retailPrice: { amount: 29, currencyCode: "PEN" }, saleability: "FOR_SALE" }, volumeInfo: { title: "Ficciones (bolsillo)" } },
          { saleInfo: { buyLink: "http://inseguro.test", retailPrice: { amount: 1, currencyCode: "PEN" }, saleability: "FOR_SALE" } },
        ],
      },
      "2026-11-08T10:00:00.000Z",
    );
    expect(offers.map((offer) => offer.price)).toEqual([29, 35.9]);
    expect(offers[1]).toMatchObject({ country: "PE", currency: "PEN", fetchedAt: "2026-11-08T10:00:00.000Z", format: "eBook", listPrice: 45, store: "Google Play Libros" });
    expect(parseGoogleOffers({}, "x")).toEqual([]);
    expect(parseGoogleOffers(null, "x")).toEqual([]);
  });

  it("enseña el precio con la moneda y el formato del país", () => {
    expect(formatPrice(35.9, "PEN", "pe")).toMatch(/35[.,]90/);
    expect(formatPrice(35.9, "PEN", "pe")).toMatch(/S\//);
    expect(formatPrice(25900, "CLP", "cl")).toMatch(/25\.900/);
  });
});

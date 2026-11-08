// @vitest-environment node
import { describe, expect, it } from "vitest";

import { storeById } from "./book-stores";
import {
  findInShard,
  groupIntoShards,
  parseProductPage,
  parseSitemapIndex,
  parseSitemapPart,
  productPageUrl,
  shardOf,
  sitemapPartUrl,
  toIsbn13,
} from "./buscalibre-prices";

const peru = storeById("pe")!;

describe("precios de Buscalibre: las direcciones (06.2b)", () => {
  it("ni el sitemap ni la ficha llevan «?», que el robots.txt de Buscalibre veta", () => {
    expect(sitemapPartUrl(peru, 7)).toBe("https://www.buscalibre.pe/sitemaps/productos_7.xml");
    expect(productPageUrl(peru, "9788425432026", "47056974")).toBe("https://www.buscalibre.pe/libro-pliegue/9788425432026/p/47056974");
    expect(sitemapPartUrl(peru, 7)).not.toContain("?");
    expect(productPageUrl(peru, "9788425432026", "47056974")).not.toContain("?");
  });

  it("pasa un ISBN-10 a ISBN-13 con su dígito de control, y descarta lo que no es un ISBN", () => {
    expect(toIsbn13("84-254-3202-6")).toBe("9788425432026");
    expect(toIsbn13("0-306-40615-2")).toBe("9780306406157");
    expect(toIsbn13("978-84-254-3202-6")).toBe("9788425432026");
    expect(toIsbn13("12345")).toBeNull();
    expect(toIsbn13(null)).toBeNull();
  });
});

describe("precios de Buscalibre: los sitemaps", () => {
  it("lee las partes del índice, sin repetir y en orden", () => {
    const xml = `<?xml version="1.0"?><sitemapindex>
      <sitemap><loc>https://www.buscalibre.pe/sitemaps/productos_1.xml</loc></sitemap>
      <sitemap><loc>https://www.buscalibre.pe/sitemaps/productos_0.xml</loc></sitemap>
      <sitemap><loc>https://www.buscalibre.pe/sitemaps/productos_1.xml</loc></sitemap>
      <sitemap><loc>https://www.buscalibre.pe/sitemaps/autores.xml</loc></sitemap>
    </sitemapindex>`;
    expect(parseSitemapIndex(xml)).toEqual([0, 1]);
  });

  it("saca ISBN-13 y número de producto, y se salta lo que no es un libro", () => {
    const xml = `<urlset>
      <url><loc>https://www.buscalibre.pe/libro-el-hombre-en-busca-de-sentido/9788425432026/p/47056974</loc></url>
      <url><loc>https://www.buscalibre.pe/oster-batidora-manual-2532_p_1.html</loc></url>
      <url><loc>https://www.buscalibre.pe/libro-la-vegetariana/9786287638662/p/62893033</loc></url>
      <url><loc>https://www.buscalibre.pe/libro-sin-isbn/0123456789/p/111</loc></url>
    </urlset>`;
    expect(parseSitemapPart(xml)).toEqual(["9788425432026 47056974", "9786287638662 62893033"]);
  });
});

describe("precios de Buscalibre: el índice en grupos", () => {
  it("reparte por las cifras 11.ª y 12.ª del ISBN y encuentra el producto con su grupo", () => {
    const shards = groupIntoShards(["9788425432026 47056974", "9786287638662 62893033", "9788408285298 55892993", "9788425432026 999"]);
    expect(shardOf("9788425432026")).toBe("02");
    expect(findInShard(shards.get("02")!, "9788425432026")).toBe("47056974");
    expect(findInShard(shards.get(shardOf("9786287638662"))!, "9786287638662")).toBe("62893033");
    // Repetido: gana el primero. Ausente: null.
    expect([...shards.values()].join("").match(/9788425432026/g)).toHaveLength(1);
    expect(findInShard(shards.get("02")!, "9788425432019")).toBeNull();
  });

  it("no confunde un ISBN con el final de otro número", () => {
    const shards = groupIntoShards(["9788425432026 47056974"]);
    expect(findInShard(`\n19788425432026 1\n${shards.get("02")!.slice(1)}`, "9788425432026")).toBe("47056974");
  });
});

const page = (...blocks: string[]) =>
  `<html><head>${blocks.map((block) => `<script type="application/ld+json">${block}</script>`).join("")}</head><body>…</body></html>`;
const organization = JSON.stringify({ "@context": "https://schema.org", "@type": "Organization", name: "Buscalibre" });
const product = (extra: object = {}) =>
  JSON.stringify({
    "@context": "https://schema.org",
    "@type": ["Product", "Book"],
    gtin13: "9788425432026",
    isbn: "9788425432026",
    name: "El Hombre En Busca de Sentido",
    offers: { "@type": "Offer", availability: "http://schema.org/InStock", price: "52.00", priceCurrency: "PEN" },
    sku: "47056974",
    ...extra,
  });

describe("precios de Buscalibre: la ficha", () => {
  it("lee precio, moneda, disponibilidad y título del JSON-LD del libro", () => {
    expect(parseProductPage(page(organization, "{no es json", product()), "9788425432026")).toEqual({
      availability: "in-stock",
      currency: "PEN",
      isbn: "9788425432026",
      price: 52,
      title: "El Hombre En Busca de Sentido",
    });
  });

  it("entiende una lista de ofertas, el @graph y las otras disponibilidades", () => {
    const graph = JSON.stringify({
      "@graph": [
        { "@type": "BreadcrumbList" },
        { "@type": "Book", isbn: "978-84-254-3202-6", name: "Otro", offers: [{ price: "" }, { availability: "https://schema.org/OutOfStock", price: 16.59, priceCurrency: "usd" }] },
      ],
    });
    expect(parseProductPage(page(graph), "9788425432026")).toMatchObject({ availability: "out-of-stock", currency: "USD", price: 16.59 });
    expect(parseProductPage(page(product({ offers: { availability: "PreOrder", price: "10", priceCurrency: "PEN" } })), "9788425432026")?.availability).toBe("preorder");
  });

  it("sin oferta con precio (no se vende en ese país) o con otro ISBN, no hay precio", () => {
    expect(parseProductPage(page(product({ offers: undefined })), "9788425432026")).toBeNull();
    expect(parseProductPage(page(product({ offers: { price: "0", priceCurrency: "PEN" } })), "9788425432026")).toBeNull();
    expect(parseProductPage(page(product()), "9786287638662")).toBeNull();
    expect(parseProductPage("<html></html>", "9788425432026")).toBeNull();
  });
});

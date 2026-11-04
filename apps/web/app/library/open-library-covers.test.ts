import { describe, expect, it } from "vitest";

import type { CatalogCover } from "./catalog-import";
import type { LibraryDocument } from "./documents";
import { applyFetchedCovers } from "./fetched-cover-store";
import {
  cleanIsbn,
  coverQueryFor,
  findOpenLibraryCover,
  needsCover,
  openLibrarySearchUrl,
  titlesMatch,
} from "./open-library-covers";

const cover = (source: CatalogCover["source"]): CatalogCover => ({ height: 450, source, src: "data:image/webp;base64,AAAA", width: 300 });
const image = () => new Blob([new Uint8Array(4_000)], { type: "image/jpeg" });

function doc(partial: Partial<LibraryDocument>): LibraryDocument {
  return { author: "Copia importada", id: "d1", title: "Meditaciones.pdf", ...partial } as LibraryDocument;
}

describe("portadas de Open Library", () => {
  it("busca para los libros sin portada o con solo la primera página del PDF", () => {
    expect(needsCover({ cover: null })).toBe(true);
    expect(needsCover({ cover: cover("pdf-page") })).toBe(true);
    expect(needsCover({ cover: cover("epub") })).toBe(false);
    expect(needsCover({ cover: cover("other") })).toBe(false);
  });

  it("arma la consulta con la ficha; sin ella, con el nombre «Título - Autor» y nunca con el rótulo de autor", () => {
    expect(coverQueryFor(doc({ title: "Meditaciones - Marco Aurelio.pdf" }))).toEqual({
      authors: ["Marco Aurelio"],
      documentId: "d1",
      isbn: null,
      title: "Meditaciones",
    });
    // El título que muestra la app ya cambió « - » por tres espacios.
    expect(coverQueryFor(doc({ title: "Niebla   Miguel de Unamuno" }))).toMatchObject({ authors: ["Miguel de Unamuno"], title: "Niebla" });
    expect(coverQueryFor(doc({ title: "Discurso del metodo" }))).toMatchObject({ authors: [], title: "Discurso del metodo" });
    expect(coverQueryFor({ ...doc({ title: "otra cosa" }), originalName: "Fortunata_y_Jacinta - Galdós.epub" })).toMatchObject({
      authors: ["Galdós"],
      title: "Fortunata y Jacinta",
    });
    const withCatalog = coverQueryFor({
      ...doc({}),
      bibliographic: { isbn: "978-84-376-0494-7" } as NonNullable<LibraryDocument["bibliographic"]>,
      catalog: { authors: ["Marco Aurelio"], canonicalTitle: "Meditaciones" } as NonNullable<LibraryDocument["catalog"]>,
    });
    expect(withCatalog).toMatchObject({ authors: ["Marco Aurelio"], isbn: "9788437604947", title: "Meditaciones" });
    expect(cleanIsbn("84-376-0494-X")).toBe("843760494X");
    expect(cleanIsbn("123")).toBeNull();
  });

  it("solo acepta un título que coincide de verdad, subtítulos incluidos", () => {
    expect(titlesMatch("Meditaciones", "Meditaciones")).toBe(true);
    expect(titlesMatch("El origen de las especies", "Origen de las especies")).toBe(true);
    expect(titlesMatch("Meditaciones", "Meditaciones: escritos para sí mismo")).toBe(true);
    expect(titlesMatch("Física cuántica", "Fisica cuantica")).toBe(true);
    expect(titlesMatch("Fortunata y Jacinta", "Fortunata y Jacinta (Spanish Edition)")).toBe(true);
    expect(titlesMatch("La vida es sueño", "La vida es sueño - El alcalde de Zalamea")).toBe(true);
    // Empezar igual no basta: son otros libros.
    expect(titlesMatch("Meditaciones", "Meditaciones metafísicas de Descartes")).toBe(false);
    expect(titlesMatch("Niebla", "La niebla y otros cuentos de terror")).toBe(false);
    expect(titlesMatch("Niebla", "Nieblas del norte")).toBe(false);
    expect(titlesMatch("Quijote", "Don Quijote de la Mancha")).toBe(false);
    expect(titlesMatch("La", "La regenta")).toBe(false);
  });

  it("con ISBN pide la portada de esa edición y no busca", async () => {
    const urls: string[] = [];
    const fetcher = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response(image(), { headers: { "content-type": "image/jpeg" } });
    }) as typeof fetch;
    const result = await findOpenLibraryCover(
      { authors: [], documentId: "d1", isbn: "9780140449334", title: "Meditations" },
      { fetcher, toCover: async () => cover("openlibrary") },
    );
    expect(result).toMatchObject({ kind: "found", via: "isbn" });
    expect(urls).toEqual(["https://covers.openlibrary.org/b/isbn/9780140449334-M.jpg?default=false"]);
  });

  it("sin ISBN busca por título y autor; prefiere el título exacto y nunca otro libro que empieza igual", async () => {
    const urls: string[] = [];
    const fetcher = (async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.startsWith("https://openlibrary.org/search.json")) {
        return Response.json({
          docs: [
            { cover_i: 1, title: "Meditaciones metafísicas" },
            { cover_i: 7, title: "Meditaciones: escritos para sí mismo" },
            { title: "Meditaciones" },
            { cover_i: 42, title: "Meditaciones" },
          ],
        });
      }
      return new Response(image(), { headers: { "content-type": "image/jpeg" } });
    }) as typeof fetch;
    const query = { authors: ["Marco Aurelio"], documentId: "d1", isbn: null, title: "Meditaciones" };
    const result = await findOpenLibraryCover(query, { fetcher, toCover: async () => cover("openlibrary") });

    expect(result).toMatchObject({ kind: "found", via: "search" });
    const search = new URL(urls[0]!);
    expect(search.searchParams.get("title")).toBe("Meditaciones");
    expect(search.searchParams.get("author")).toBe("Marco Aurelio");
    // Ni Descartes (empieza igual) ni el del subtítulo: hay uno exacto con portada.
    expect(urls[1]).toBe("https://covers.openlibrary.org/b/id/42-M.jpg");
    expect(openLibrarySearchUrl(query)).toContain("fields=title%2Ccover_i");
  });

  it("si nada coincide, o la imagen no sirve, se queda sin portada", async () => {
    const noMatch = (async () => Response.json({ docs: [{ cover_i: 5, title: "Otro libro" }] })) as typeof fetch;
    expect(await findOpenLibraryCover({ authors: [], documentId: "d1", isbn: null, title: "Niebla" }, { fetcher: noMatch, toCover: async () => cover("openlibrary") })).toEqual({ kind: "not-found" });

    const tiny = (async (input: RequestInfo | URL) =>
      String(input).includes("search.json")
        ? Response.json({ docs: [{ cover_i: 5, title: "Niebla" }] })
        : new Response(new Blob([new Uint8Array(10)], { type: "image/gif" }))) as typeof fetch;
    expect(await findOpenLibraryCover({ authors: [], documentId: "d1", isbn: null, title: "Niebla" }, { fetcher: tiny, toCover: async () => cover("openlibrary") })).toEqual({ kind: "not-found" });
  });

  it("la portada traída llena lo que falta, pero no pisa la del EPUB", () => {
    const documents = [doc({ cover: null, id: "a" }), doc({ cover: cover("pdf-page"), id: "b" }), doc({ cover: cover("epub"), id: "c" })];
    const records = ["a", "b", "c"].map((documentId) => ({ cover: cover("openlibrary"), documentId, fetchedAt: "2026-11-04", status: "found" as const }));
    const applied = applyFetchedCovers(documents, [...records, { documentId: "x", fetchedAt: "2026-11-04", status: "not-found" as const }]);
    expect(applied.map((document) => document.cover?.source)).toEqual(["openlibrary", "openlibrary", "epub"]);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LibraryDocument } from "./documents";

// Los almacenes leen `window.localStorage`; en node, un sustituto en memoria.
const memory = new Map<string, string>();
const storage = {
  getItem: (key: string) => memory.get(key) ?? null,
  removeItem: (key: string) => memory.delete(key),
  setItem: (key: string, value: string) => memory.set(key, value),
};
vi.stubGlobal("localStorage", storage);
vi.stubGlobal("window", { addEventListener: () => {}, dispatchEvent: () => true, localStorage: storage, removeEventListener: () => {} });

const { librarySignalsFor, loadRecommendations, recommendationsMaxAgeMs } = await import("./taste-store");
const { emptyTasteProfile } = await import("./recommendations");

function book(id: string, name: string, reference: LibraryDocument["reference"] = { kind: "local-file", referenceId: id }, extra: Partial<LibraryDocument> = {}) {
  return { author: "Copia importada", format: "epub", id, meta: "", reference, title: name, ...extra } as LibraryDocument;
}

const rayuela = book("a", "Rayuela - Julio Cortázar");
const diario = book("b", "Diario intimo - Ana Secreta");
const cartas = book("c", "Cartas - Pedro Personal", { kind: "local-folder", relativePath: "cartas.epub", sourceId: "privada" });
const ficciones = book("d", "Ficciones.epub", undefined, { catalog: { authors: ["Jorge Luis Borges"], canonicalTitle: "Ficciones", genres: ["Cuento"], topics: ["Literatura fantástica"] } as NonNullable<LibraryDocument["catalog"]> });

function mark(documents: Record<string, string>, sources: Record<string, string> = {}) {
  memory.set("pliegue-sensitivity-v1", JSON.stringify({ consents: {}, documents, sources }));
}

const doc = (key: string, title: string, author: string) => ({ author_name: [author], cover_i: 1, first_publish_year: 1980, key, ratings_average: 4, ratings_count: 20, title });
const openLibrary = (docs: unknown[]) => vi.fn().mockImplementation(async () => Response.json({ docs, numFound: docs.length }));

beforeEach(() => memory.clear());

describe("señales de la biblioteca para «Para ti» (06.1)", () => {
  it("deja fuera los libros confidenciales y los de una fuente personal", () => {
    mark({ b: "confidencial" }, { "folder:privada": "personal" });
    const names = librarySignalsFor([rayuela, diario, cartas, ficciones]).authors.map((author) => author.name);
    expect(names).toContain("Julio Cortázar");
    expect(names).toContain("Jorge Luis Borges");
    expect(names).not.toContain("Ana Secreta");
    expect(names).not.toContain("Pedro Personal");
  });

  it("un libro personal marcado a mano también se queda fuera, y un favorito cuenta doble", () => {
    mark({ a: "personal" });
    memory.set("pliegue-library-favorites-v1", JSON.stringify(["d"]));
    const signals = librarySignalsFor([rayuela, ficciones]);
    expect(signals.authors).toEqual([{ count: 2, name: "Jorge Luis Borges" }]);
    expect(signals.subjects.every((subject) => subject.count === 2)).toBe(true);
  });
});

describe("lo recomendado (06.1)", () => {
  const profile = { ...emptyTasteProfile, authors: ["Isabel Allende"], enabled: true, subjects: ["realismo-magico"] };

  it("sin permiso, no busca nada de la biblioteca; con permiso, nunca al autor confidencial", async () => {
    mark({ b: "confidencial" });
    const fetcher = openLibrary([]);
    await loadRecommendations(profile, [rayuela, diario], { fetcher });
    const declared = fetcher.mock.calls.map((call) => decodeURIComponent(String(call[0])));
    expect(declared.some((url) => /Cort|Secreta|Rayuela|Diario/.test(url))).toBe(false);

    const withLibrary = openLibrary([]);
    await loadRecommendations({ ...profile, useLibrary: true }, [rayuela, diario], { fetcher: withLibrary, force: true });
    const urls = withLibrary.mock.calls.map((call) => decodeURIComponent(String(call[0]).replaceAll("+", " ")));
    expect(urls.some((url) => url.includes("Julio Cortázar"))).toBe(true);
    expect(urls.some((url) => /Secreta|Rayuela|Diario/.test(url))).toBe(false);
  });

  it("se recuerda un día para los mismos gustos, sin lo descartado ni lo que ya se tiene", async () => {
    const fetcher = openLibrary([doc("/works/1", "La casa de los espíritus", "Isabel Allende"), doc("/works/2", "Paula", "Isabel Allende")]);
    const now = () => new Date("2026-11-08T10:00:00Z");
    const first = await loadRecommendations(profile, [], { fetcher, now });
    expect(first.items.map((item) => item.title)).toEqual(expect.arrayContaining(["La casa de los espíritus", "Paula"]));
    const calls = fetcher.mock.calls.length;

    const later = () => new Date(Date.parse("2026-11-08T10:00:00Z") + recommendationsMaxAgeMs - 1000);
    const paulaKey = first.items.find((item) => item.title === "Paula")!.key;
    const again = await loadRecommendations({ ...profile, dismissed: [paulaKey] }, [book("e", "La casa de los espíritus - Isabel Allende")], { fetcher, now: later });
    expect(fetcher.mock.calls.length).toBe(calls);
    expect(again.items).toEqual([]);

    const nextDay = () => new Date(Date.parse("2026-11-08T10:00:00Z") + recommendationsMaxAgeMs + 1000);
    await loadRecommendations(profile, [], { fetcher, now: nextDay });
    expect(fetcher.mock.calls.length).toBeGreaterThan(calls);
  });

  it("si Open Library no responde, lo dice y no lo recuerda", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("sin conexión"));
    const result = await loadRecommendations(profile, [], { fetcher });
    expect(result.failed).toBe(result.searched);
    expect(memory.has("pliegue-recommendations-v1")).toBe(false);
  });
});

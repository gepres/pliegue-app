import { beforeEach, describe, expect, it, vi } from "vitest";

const config = vi.hoisted(() => ({ drive: { apiKey: "clave-publica", appId: "1", clientId: "x.apps.googleusercontent.com" } as { apiKey: string } | null }));
vi.mock("../config/public-config", () => ({ publicConfig: config }));

const memory = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => memory.get(key) ?? null,
  removeItem: (key: string) => memory.delete(key),
  setItem: (key: string, value: string) => memory.set(key, value),
});

const { lookupDigitalOffers, offersMaxAgeMs } = await import("./book-offers-store");

const book = { authors: ["Jorge Luis Borges"], isbn: "9788466338141", title: "Ficciones" };
const sale = { items: [{ saleInfo: { buyLink: "https://play.google.com/x", country: "PE", retailPrice: { amount: 35.9, currencyCode: "PEN" }, saleability: "FOR_SALE" }, volumeInfo: { title: "Ficciones" } }] };
const ok = () => vi.fn().mockResolvedValue(Response.json(sale));

beforeEach(() => {
  memory.clear();
  config.drive = { apiKey: "clave-publica" };
});

describe("precios digitales de Google Play (06.2)", () => {
  it("pregunta con la clave pública y el país, y devuelve el precio con la fecha", async () => {
    const fetcher = ok();
    const result = await lookupDigitalOffers(book, "pe", { fetcher, now: () => new Date("2026-11-08T10:00:00Z") });
    expect(result).toMatchObject({ fetchedAt: "2026-11-08T10:00:00.000Z", status: "ok" });
    expect(result.status === "ok" && result.offers[0]).toMatchObject({ currency: "PEN", price: 35.9 });
    const url = new URL(String(fetcher.mock.calls[0]?.[0]));
    expect(url.searchParams.get("q")).toBe("isbn:9788466338141");
    expect(url.searchParams.get("country")).toBe("PE");
  });

  it("lo consultado se recuerda un día; después se vuelve a preguntar", async () => {
    const fetcher = ok();
    const start = new Date("2026-11-08T10:00:00Z").getTime();
    await lookupDigitalOffers(book, "pe", { fetcher, now: () => new Date(start) });
    await lookupDigitalOffers(book, "pe", { fetcher, now: () => new Date(start + offersMaxAgeMs - 1000) });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await lookupDigitalOffers(book, "co", { fetcher, now: () => new Date(start) });
    expect(fetcher).toHaveBeenCalledTimes(2);
    await lookupDigitalOffers(book, "pe", { fetcher, now: () => new Date(start + offersMaxAgeMs + 1000) });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("sin clave, o con la Books API sin activar, no hay precios y no es un error", async () => {
    config.drive = null;
    const fetcher = ok();
    expect(await lookupDigitalOffers(book, "pe", { fetcher })).toEqual({ status: "unavailable" });
    expect(fetcher).not.toHaveBeenCalled();
    config.drive = { apiKey: "clave-publica" };
    const blocked = vi.fn().mockResolvedValue(Response.json({ error: { code: 403, message: "Books API has not been used" } }, { status: 403 }));
    expect(await lookupDigitalOffers(book, "pe", { fetcher: blocked })).toEqual({ status: "unavailable" });
    const offline = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await lookupDigitalOffers(book, "pe", { fetcher: offline })).toEqual({ status: "unavailable" });
  });
});

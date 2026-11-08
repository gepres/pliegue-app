import { supabaseHeaders, type LibraryBaseConfig } from "../library-access/access-server";
import { sessionUser } from "../library-access/shared-library-server";
import { storeById, type BookStore } from "./book-stores";
import {
  buscalibreUserAgent,
  isIsbn13,
  isProductId,
  maxSitemapParts,
  parseProductPage,
  parseSitemapIndex,
  parseSitemapPart,
  productPageUrl,
  sitemapIndexUrl,
  sitemapPartUrl,
  type BuscalibreProduct,
} from "./buscalibre-prices";

/**
 * El lado del servidor de los precios de Buscalibre (06.2b): **solo para el admin**. Antes de
 * preguntar nada a Buscalibre se comprueba la sesión con Supabase Auth y que la cuenta está en
 * `pliegue_admins`. Quien no es admin recibe 401 o 403 y Buscalibre no se entera de nada.
 *
 * A Buscalibre solo se le piden los sitemaps de productos y las fichas: nunca una URL con `?`
 * (su robots.txt veta `/*?*`, que son sus búsquedas). Nada de lo que responde se guarda aquí.
 */

export interface BuscalibreServerDeps {
  config: LibraryBaseConfig | null;
  fetcher?: typeof fetch;
  now?: () => Date;
}

/** Lo más que se lee de una respuesta de Buscalibre: un sitemap pesa ~0,7 MB y una ficha ~0,2 MB. */
const maxResponseBytes = 4 * 1024 * 1024;
const timeoutMs = 15_000;

const json = (body: unknown, status = 200) => Response.json(body, { headers: { "Cache-Control": "private, no-store" }, status });
const fail = (status: number, error: string) => json({ error }, status);

/** Solo desde las páginas de Pliegue. */
function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

type AdminCheck = "admin" | "no-session" | "not-admin" | "unavailable";

/** ¿La sesión es de un admin de Pliegue? Primero quién es (Auth) y luego si está en `pliegue_admins`. */
export async function checkAdmin(accessToken: string, deps: BuscalibreServerDeps): Promise<AdminCheck> {
  const { config } = deps;
  if (!config) return "unavailable";
  if (!accessToken) return "no-session";
  const user = await sessionUser(accessToken, { config, ...(deps.fetcher ? { fetcher: deps.fetcher } : {}) });
  if (!user) return "no-session";
  try {
    const response = await (deps.fetcher ?? fetch)(`${config.supabaseUrl}/rest/v1/pliegue_admins?select=user_id&user_id=eq.${encodeURIComponent(user.id)}`, {
      cache: "no-store",
      headers: supabaseHeaders(config.secretKey),
    });
    if (!response.ok) return "unavailable";
    const rows = (await response.json()) as unknown;
    return Array.isArray(rows) && rows.length > 0 ? "admin" : "not-admin";
  } catch {
    return "unavailable";
  }
}

type Fetched = { ok: true; status: number; text: string; url: string } | { ok: false; status: number };

/** Una página de Buscalibre. Nunca con `?`: si alguien lo intentara, ni se pide. */
async function fetchBuscalibre(url: string, deps: BuscalibreServerDeps): Promise<Fetched> {
  if (url.includes("?")) throw new Error("Buscalibre veta en su robots.txt las URL con «?».");
  try {
    const response = await (deps.fetcher ?? fetch)(url, {
      cache: "no-store",
      headers: { Accept: "text/html,application/xml;q=0.9,*/*;q=0.5", "User-Agent": buscalibreUserAgent },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return { ok: false, status: response.status };
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > maxResponseBytes) return { ok: false, status: 413 };
    const text = await response.text();
    if (text.length > maxResponseBytes) return { ok: false, status: 413 };
    return { ok: true, status: response.status, text, url: response.url || url };
  } catch {
    return { ok: false, status: 0 };
  }
}

/** La sesión, el país y el admin: lo común de las dos rutas. Devuelve la tienda o la respuesta de error. */
async function guard(request: Request, deps: BuscalibreServerDeps): Promise<BookStore | Response> {
  if (!sameOrigin(request)) return fail(403, "Origen no permitido.");
  const store = storeById(new URL(request.url).searchParams.get("pais"));
  if (!store) return fail(400, "Falta el país de la tienda, o no es uno de Buscalibre.");
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  const admin = await checkAdmin(token, deps);
  if (admin === "unavailable") return fail(503, "No se pudo comprobar tu cuenta ahora. Inténtalo dentro de un rato.");
  if (admin === "no-session") return fail(401, "Tu sesión caducó. Vuelve a entrar.");
  if (admin === "not-admin") return fail(403, "Los precios de Buscalibre solo los ve el admin de Pliegue.");
  return store;
}

const unreachable = () => fail(502, "Buscalibre no respondió. Inténtalo dentro de un rato.");

/**
 * GET `/api/buscalibre/indice?pais=pe` → `{ parts: [0, 1, …] }`, las partes del sitemap.
 * GET `/api/buscalibre/indice?pais=pe&parte=3` → `{ part: 3, count, entries: "ISBN id\n…" }`.
 */
export async function handleBuscalibreIndex(request: Request, deps: BuscalibreServerDeps): Promise<Response> {
  const store = await guard(request, deps);
  if (store instanceof Response) return store;
  const raw = new URL(request.url).searchParams.get("parte");
  if (raw === null) {
    const fetched = await fetchBuscalibre(sitemapIndexUrl(store), deps);
    if (!fetched.ok) return unreachable();
    const parts = parseSitemapIndex(fetched.text);
    return parts.length ? json({ parts }) : fail(502, "Buscalibre no publicó su lista de libros.");
  }
  if (!/^\d{1,3}$/.test(raw) || Number(raw) >= maxSitemapParts) return fail(400, "Esa parte de la lista no existe.");
  const part = Number(raw);
  const fetched = await fetchBuscalibre(sitemapPartUrl(store, part), deps);
  if (!fetched.ok) return fetched.status === 404 ? fail(404, "Esa parte de la lista no existe.") : unreachable();
  const entries = parseSitemapPart(fetched.text);
  return json({ count: entries.length, entries: entries.join("\n"), part });
}

export type BuscalibrePriceResponse =
  | ({ fetchedAt: string; found: true; url: string } & BuscalibreProduct)
  /** La ficha no existe en ese país, o existe pero no tiene precio (no se vende allí). */
  | { fetchedAt: string; found: false };

/** GET `/api/buscalibre/precio?pais=pe&isbn=978…&id=47056974` → el precio de la ficha en ese país. */
export async function handleBuscalibrePrice(request: Request, deps: BuscalibreServerDeps): Promise<Response> {
  const store = await guard(request, deps);
  if (store instanceof Response) return store;
  const params = new URL(request.url).searchParams;
  const isbn = params.get("isbn") ?? "";
  const productId = params.get("id") ?? "";
  if (!isIsbn13(isbn) || !isProductId(productId)) return fail(400, "Falta el ISBN-13 o el número de producto.");
  const fetchedAt = (deps.now?.() ?? new Date()).toISOString();
  const fetched = await fetchBuscalibre(productPageUrl(store, isbn, productId), deps);
  if (!fetched.ok) return fetched.status === 404 || fetched.status === 410 ? json({ fetchedAt, found: false } satisfies BuscalibrePriceResponse) : unreachable();
  const product = parseProductPage(fetched.text, isbn);
  if (!product) return json({ fetchedAt, found: false } satisfies BuscalibrePriceResponse);
  // El enlace es la ficha a la que llegó (la de su nombre bueno), si sigue en la tienda del país.
  const final = new URL(fetched.url);
  const url = final.origin === store.host && /^\/libro-[^/?]+\/\d{13}\/p\/\d+$/.test(final.pathname) ? `${final.origin}${final.pathname}` : productPageUrl(store, isbn, productId);
  return json({ ...product, fetchedAt, found: true, url } satisfies BuscalibrePriceResponse);
}

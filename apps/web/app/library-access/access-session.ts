/**
 * La sesión de quien entra en la biblioteca general con un código: un testigo firmado por el
 * servidor (HMAC-SHA256) que viaja en una cookie httpOnly. No hay cuenta: lleva el código
 * canjeado, el nombre que dio el visitante y su equipo anónimo, y caduca sola.
 *
 * Es un formato propio y mínimo —`datos.firma`, ambos en base64url—, no un JWT: solo lo firma y
 * lo lee este servidor. Web Crypto, para que funcione igual en Node y en el borde.
 */
export const sessionCookieName = "pliegue-biblioteca-general";
export const sessionVersion = 1;
/** Treinta días, salvo que el código caduque antes. */
export const maxSessionMs = 30 * 24 * 60 * 60 * 1000;

export interface LibrarySession {
  codeId: string;
  device: string;
  /** Caducidad, en milisegundos desde 1970. */
  exp: number;
  iat: number;
  library: string;
  name: string;
  v: typeof sessionVersion;
}

const encoder = new TextEncoder();
/** Separa estas firmas de cualquier otro uso del mismo secreto. */
const purpose = "pliegue-biblioteca-sesion:";

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(value: string) {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function hmac(secret: string, data: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { hash: "SHA-256", name: "HMAC" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(purpose + data)));
}

/** Comparación en tiempo constante: no revela por dónde difiere una firma falsa. */
function sameBytes(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return difference === 0;
}

export async function signSession(session: LibrarySession, secret: string) {
  const data = toBase64Url(encoder.encode(JSON.stringify(session)));
  return `${data}.${toBase64Url(await hmac(secret, data))}`;
}

function isSession(value: unknown): value is LibrarySession {
  if (!value || typeof value !== "object") return false;
  const session = value as Record<string, unknown>;
  return (
    session.v === sessionVersion &&
    typeof session.codeId === "string" &&
    typeof session.device === "string" &&
    typeof session.library === "string" &&
    typeof session.name === "string" &&
    typeof session.exp === "number" &&
    typeof session.iat === "number"
  );
}

/** La sesión si la firma es buena y no ha caducado; si no, `null`. */
export async function verifySession(token: string | undefined, secret: string, now = Date.now()): Promise<LibrarySession | null> {
  if (!token || !secret) return null;
  const [data, signature, extra] = token.split(".");
  if (!data || !signature || extra !== undefined) return null;
  try {
    if (!sameBytes(fromBase64Url(signature), await hmac(secret, data))) return null;
    const session: unknown = JSON.parse(new TextDecoder().decode(fromBase64Url(data)));
    if (!isSession(session) || session.exp <= now) return null;
    return session;
  } catch {
    return null;
  }
}

/** Cuándo caduca una sesión nueva: a los treinta días o con el código, lo que llegue antes. */
export function sessionExpiry(now: number, codeExpiresAt: string | null) {
  const codeEnd = codeExpiresAt ? Date.parse(codeExpiresAt) : Number.NaN;
  return Number.isFinite(codeEnd) ? Math.min(now + maxSessionMs, codeEnd) : now + maxSessionMs;
}

/** «  oct2026 arequipa » → «OCT2026AREQUIPA». `null` si no puede ser un código. */
export function normalizeAccessCode(value: string) {
  const code = value.normalize("NFKC").toUpperCase().replace(/\s+/g, "");
  return /^[A-Z0-9][A-Z0-9-]{3,39}$/.test(code) ? code : null;
}

/** El nombre que da el visitante, limpio: sin saltos ni espacios de más, hasta 60 caracteres. */
export function normalizeVisitorName(value: string) {
  const name = value.normalize("NFC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  return name.length ? name : null;
}

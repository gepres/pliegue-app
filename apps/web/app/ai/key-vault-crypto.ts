/**
 * El cifrado de la bóveda de claves (02.5), con WebCrypto y nada más.
 *
 * - **En este equipo** (niveles «hasta cerrar sesión» y «en este navegador»): AES-GCM con una
 *   llave de 256 bits que el navegador crea **no exportable**. Se guarda en IndexedDB como
 *   objeto `CryptoKey`: se puede usar para descifrar, pero no leer ni copiar a otro sitio.
 * - **En la cuenta**: AES-GCM con una llave derivada de la frase de la persona (PBKDF2-SHA256,
 *   600.000 vueltas, sal aleatoria). La frase nunca sale del navegador: Supabase recibe solo el
 *   texto cifrado, el vector y la sal.
 *
 * Cada cifrado lleva como datos asociados (AAD) a qué proveedor y a qué cuenta pertenece: un
 * texto cifrado copiado a otra fila u otra cuenta no se descifra.
 */

export const passphraseIterations = 600_000;
export const minPassphraseLength = 10;

export interface SealedSecret {
  /** Texto cifrado (con la etiqueta de AES-GCM), en base64. */
  data: string;
  /** Vector de inicio de 12 bytes, en base64. Uno nuevo en cada cifrado. */
  iv: string;
}

export interface PassphraseKdf {
  hash: "SHA-256";
  iterations: number;
  name: "PBKDF2";
  /** Sal de 16 bytes, en base64. */
  salt: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64(text: string) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** La llave de este navegador: no exportable, solo para cifrar y descifrar. */
export function createDeviceKey() {
  return crypto.subtle.generateKey({ length: 256, name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/** Lo que ata un texto cifrado a su sitio: el proveedor y, en la cuenta, de quién es. */
export function secretContext(provider: string, userId: string | null = null) {
  return `pliegue-clave:v1:${provider}:${userId ?? "este-equipo"}`;
}

export async function sealSecret(key: CryptoKey, plaintext: string, context: string): Promise<SealedSecret> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ additionalData: encoder.encode(context), iv, name: "AES-GCM" }, key, encoder.encode(plaintext));
  return { data: toBase64(new Uint8Array(data)), iv: toBase64(iv) };
}

/** Descifra; si la llave, el contexto o el texto no cuadran, AES-GCM falla y se lanza. */
export async function openSecret(key: CryptoKey, sealed: SealedSecret, context: string) {
  const plain = await crypto.subtle.decrypt(
    { additionalData: encoder.encode(context), iv: fromBase64(sealed.iv), name: "AES-GCM" },
    key,
    fromBase64(sealed.data),
  );
  return decoder.decode(plain);
}

export function newPassphraseKdf(): PassphraseKdf {
  return { hash: "SHA-256", iterations: passphraseIterations, name: "PBKDF2", salt: toBase64(crypto.getRandomValues(new Uint8Array(16))) };
}

/** La llave que sale de la frase: no exportable, y la misma en cualquier equipo con la misma sal. */
export async function derivePassphraseKey(passphrase: string, kdf: PassphraseKdf) {
  const material = await crypto.subtle.importKey("raw", encoder.encode(passphrase.normalize("NFC")), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { hash: kdf.hash, iterations: kdf.iterations, name: "PBKDF2", salt: fromBase64(kdf.salt) },
    material,
    { length: 256, name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Lo que falla de una frase nueva, o null si vale. */
export function passphraseIssue(passphrase: string, confirmation?: string) {
  if (passphrase.trim().length < minPassphraseLength) return `Usa al menos ${minPassphraseLength} caracteres: mejor varias palabras que solo tú recuerdes.`;
  if (confirmation !== undefined && confirmation !== passphrase) return "Las dos frases no coinciden.";
  return null;
}

/** Que lo que llega de la base de datos tenga forma de texto cifrado y de parámetros de la frase. */
export function isSealedSecret(value: unknown): value is SealedSecret {
  return Boolean(value) && typeof (value as SealedSecret).data === "string" && typeof (value as SealedSecret).iv === "string";
}

export function isPassphraseKdf(value: unknown): value is PassphraseKdf {
  const kdf = value as PassphraseKdf;
  return Boolean(kdf) && kdf.name === "PBKDF2" && kdf.hash === "SHA-256" && Number.isInteger(kdf.iterations) && kdf.iterations >= 100_000 && typeof kdf.salt === "string";
}

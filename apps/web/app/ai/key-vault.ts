"use client";

import { useSyncExternalStore } from "react";

import { cloudClient } from "../cloud/supabase-client";
import { clearSessionApiKey, setSessionApiKey } from "./ai-session-secret-store";
import type { KeyProvider } from "./api-key";
import {
  createDeviceKey,
  derivePassphraseKey,
  isPassphraseKdf,
  isSealedSecret,
  newPassphraseKdf,
  openSecret,
  sealSecret,
  secretContext,
  type PassphraseKdf,
  type SealedSecret,
} from "./key-vault-crypto";

/**
 * La bóveda de claves (02.5, decisión del dueño del 8-nov). Cada clave se recuerda como elija la
 * persona:
 * - `tab`: solo en la memoria de esta pestaña (como siempre, y por defecto);
 * - `session`: cifrada en este navegador hasta cerrar sesión en Pliegue;
 * - `browser`: cifrada en este navegador hasta «Olvidar»;
 * - `account`: cifrada con una frase suya y guardada en su cuenta (`user_secrets`), para sus
 *   otros equipos. Aquí también queda una copia cifrada, hasta cerrar sesión.
 *
 * En claro, la clave solo vive en la memoria de la pestaña (`ai-session-secret-store`), que es
 * de donde la toman las peticiones. Lo guardado está siempre cifrado: con la llave no exportable
 * del navegador (`session`, `browser` y la copia de `account`) o con la de la frase (`account`,
 * en Supabase). La frase nunca se guarda ni se envía; su llave derivada, no exportable, se
 * recuerda en este navegador hasta cerrar sesión, para no pedirla en cada recarga.
 */

export const keyPersistences = ["tab", "session", "browser", "account"] as const;
export type KeyPersistence = (typeof keyPersistences)[number];
type StoredPersistence = Exclude<KeyPersistence, "tab">;

export const keyProviders: readonly KeyProvider[] = ["anthropic", "azure", "deepl", "gemini", "libretranslate", "openai"];

interface LocalSecret {
  persistence: StoredPersistence;
  provider: KeyProvider;
  savedAt: string;
  sealed: SealedSecret;
  /** De qué cuenta es (`session` y `account`); null en `browser`. */
  userId: string | null;
}

interface StoredKey {
  id: string;
  key: CryptoKey;
  kdf?: PassphraseKdf;
}

export interface KeyVaultState {
  account: {
    /** Proveedores con clave guardada en la cuenta (lo que dice Supabase). */
    remote: KeyProvider[];
    /** ¿Está la llave de la frase en este navegador? */
    unlocked: boolean;
    userId: string | null;
  };
  /** Algo no fue bien al guardar o leer (sin datos de la clave). */
  error: string | null;
  /** Cómo se recuerda cada clave. Lo que no está, `tab`. */
  levels: Partial<Record<KeyProvider, KeyPersistence>>;
  ready: boolean;
}

/** La cuenta no tiene la llave de la frase en este navegador: hay que pedirla. */
export class VaultLockedError extends Error {
  constructor() {
    super("Escribe tu frase para guardar claves en la cuenta.");
  }
}

const databaseName = "pliegue-key-vault";
const keyStore = "keys";
const secretStore = "secrets";
const deviceKeyId = "device";
const accountKeyId = (userId: string) => `account:${userId}`;
const levelsStorageKey = "pliegue-key-persistence-v1";

/* ---- Estado para la interfaz ---------------------------------------------------------------------- */

const initial: KeyVaultState = { account: { remote: [], unlocked: false, userId: null }, error: null, levels: {}, ready: false };
let state: KeyVaultState = initial;
const listeners = new Set<() => void>();

function emit(patch: Partial<KeyVaultState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

export function useKeyVault() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
    () => initial,
  );
}

export function readKeyVault() {
  return state;
}

/* ---- IndexedDB ------------------------------------------------------------------------------------------ */

function requestResult<Result>(request: IDBRequest<Result>) {
  return new Promise<Result>((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error), { once: true });
  });
}

let databasePromise: Promise<IDBDatabase> | null = null;

function openDatabase() {
  databasePromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.addEventListener(
      "upgradeneeded",
      () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(keyStore)) database.createObjectStore(keyStore, { keyPath: "id" });
        if (!database.objectStoreNames.contains(secretStore)) database.createObjectStore(secretStore, { keyPath: "provider" });
      },
      { once: true },
    );
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => {
      databasePromise = null;
      reject(request.error);
    }, { once: true });
  });
  return databasePromise;
}

async function store(name: string, mode: IDBTransactionMode) {
  return (await openDatabase()).transaction(name, mode).objectStore(name);
}

async function readSecrets() {
  return (await requestResult((await store(secretStore, "readonly")).getAll())) as LocalSecret[];
}

async function putSecret(record: LocalSecret) {
  await requestResult((await store(secretStore, "readwrite")).put(record));
}

async function deleteSecret(provider: KeyProvider) {
  await requestResult((await store(secretStore, "readwrite")).delete(provider));
}

async function readKey(id: string) {
  return ((await requestResult((await store(keyStore, "readonly")).get(id))) as StoredKey | undefined) ?? null;
}

async function putKey(record: StoredKey) {
  await requestResult((await store(keyStore, "readwrite")).put(record));
}

async function deleteKey(id: string) {
  await requestResult((await store(keyStore, "readwrite")).delete(id));
}

/** La llave de este navegador; se crea la primera vez que se guarda algo. */
async function deviceKey() {
  const existing = await readKey(deviceKeyId);
  if (existing) return existing.key;
  const key = await createDeviceKey();
  await putKey({ id: deviceKeyId, key });
  return key;
}

/* ---- Preferencias (no secretas) ------------------------------------------------------------------------- */

function readLevels(): Partial<Record<KeyProvider, KeyPersistence>> {
  try {
    const parsed = JSON.parse(localStorage.getItem(levelsStorageKey) ?? "{}") as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([provider, level]) => keyProviders.includes(provider as KeyProvider) && keyPersistences.includes(level as KeyPersistence),
      ),
    ) as Partial<Record<KeyProvider, KeyPersistence>>;
  } catch {
    return {};
  }
}

function writeLevel(provider: KeyProvider, level: KeyPersistence) {
  const levels = { ...state.levels, [provider]: level };
  if (level === "tab") delete levels[provider];
  try {
    localStorage.setItem(levelsStorageKey, JSON.stringify(levels));
  } catch {
    // Sin almacenamiento, la elección dura lo que la pestaña.
  }
  emit({ levels });
}

/* ---- Supabase --------------------------------------------------------------------------------------------- */

interface RemoteSecret {
  ciphertext: string;
  iv: string;
  kdf: unknown;
  provider: string;
}

function describeRemoteError(error: { code?: string; message?: string } | null) {
  if (!error) return null;
  if (error.code === "42P01" || error.code === "PGRST205" || /user_secrets/.test(error.message ?? "")) {
    return "La cuenta aún no admite guardar claves: falta aplicar la migración de la bóveda en Supabase.";
  }
  return "No se pudo hablar con tu cuenta. Revisa la conexión y vuelve a intentarlo.";
}

async function readRemote(userId: string): Promise<RemoteSecret[]> {
  const client = cloudClient();
  if (!client) return [];
  const { data, error } = await client.from("user_secrets").select("provider, ciphertext, iv, kdf").eq("user_id", userId);
  if (error) throw new Error(describeRemoteError(error) ?? "No se pudo leer la cuenta.");
  return ((data ?? []) as RemoteSecret[]).filter((row) => keyProviders.includes(row.provider as KeyProvider));
}

async function writeRemote(userId: string, provider: KeyProvider, sealed: SealedSecret, kdf: PassphraseKdf) {
  const client = cloudClient();
  if (!client) throw new Error("Esta instalación de Pliegue no tiene cuenta.");
  const { error } = await client
    .from("user_secrets")
    .upsert({ ciphertext: sealed.data, iv: sealed.iv, kdf, provider, updated_at: new Date().toISOString(), user_id: userId }, { onConflict: "user_id,provider" });
  if (error) throw new Error(describeRemoteError(error) ?? "No se pudo guardar en la cuenta.");
}

async function deleteRemote(userId: string, provider?: KeyProvider) {
  const client = cloudClient();
  if (!client) return;
  let query = client.from("user_secrets").delete().eq("user_id", userId);
  if (provider) query = query.eq("provider", provider);
  const { error } = await query;
  if (error) throw new Error(describeRemoteError(error) ?? "No se pudo borrar de la cuenta.");
}

/* ---- Cargar y seguir a la cuenta ------------------------------------------------------------------------ */

let currentUser: string | null = null;
let syncing: Promise<void> = Promise.resolve();

/**
 * Pone la bóveda al día con la cuenta: lo de otra cuenta o de una sesión cerrada se borra, lo
 * demás se descifra a la memoria de la pestaña, y, si la llave de la frase está en este
 * navegador, se bajan las claves de la cuenta. `userId` null = sin sesión.
 */
export function syncKeyVault(userId: string | null) {
  syncing = syncing.then(() => runSync(userId)).catch(() => undefined);
  return syncing;
}

async function runSync(userId: string | null) {
  if (typeof indexedDB === "undefined") return;
  currentUser = userId;
  const levels = readLevels();
  try {
    const secrets = await readSecrets();
    const stale = secrets.filter((record) => record.persistence !== "browser" && record.userId !== userId);
    for (const record of stale) {
      await deleteSecret(record.provider);
      if (levels[record.provider] === record.persistence) delete levels[record.provider];
    }
    if (!userId) await forgetAccountKeys();
    const kept = secrets.filter((record) => !stale.includes(record));
    // Sin nada guardado no se crea la llave del navegador: quien no usa la bóveda no la tiene.
    const key = kept.length ? await deviceKey() : null;
    for (const record of kept) {
      if (!key) break;
      try {
        setSessionApiKey(record.provider, await openSecret(key, record.sealed, secretContext(record.provider, record.userId)));
        levels[record.provider] = record.persistence;
      } catch {
        // Cifrado con una llave que ya no existe (datos del navegador borrados a medias): fuera.
        await deleteSecret(record.provider);
      }
    }
    emit({ account: { remote: [], unlocked: false, userId }, error: null, levels, ready: true });
    if (userId) await refreshAccount(userId);
  } catch {
    emit({ error: "No se pudieron leer las claves guardadas en este navegador.", levels, ready: true });
  }
}

/** Lo que hay en la cuenta y, si la llave de la frase está aquí, sus claves. */
async function refreshAccount(userId: string) {
  let rows: RemoteSecret[];
  try {
    rows = await readRemote(userId);
  } catch (error) {
    emit({ account: { ...state.account, userId }, error: error instanceof Error ? error.message : null });
    return;
  }
  const cached = await readKey(accountKeyId(userId));
  const remote = rows.map((row) => row.provider as KeyProvider);
  if (!cached) {
    emit({ account: { remote, unlocked: false, userId } });
    return;
  }
  await openRemoteRows(userId, rows, cached.key);
  emit({ account: { remote, unlocked: true, userId } });
}

/** Descifra las filas de la cuenta a la memoria y deja aquí su copia, hasta cerrar sesión. */
async function openRemoteRows(userId: string, rows: RemoteSecret[], key: CryptoKey) {
  const device = await deviceKey();
  const levels = { ...state.levels };
  for (const row of rows) {
    const provider = row.provider as KeyProvider;
    const plain = await openSecret(key, { data: row.ciphertext, iv: row.iv }, secretContext(provider, userId));
    setSessionApiKey(provider, plain);
    await putSecret({ persistence: "account", provider, savedAt: new Date().toISOString(), sealed: await sealSecret(device, plain, secretContext(provider, userId)), userId });
    levels[provider] = "account";
  }
  emit({ levels });
}

async function forgetAccountKeys() {
  const database = await openDatabase();
  const keys = (await requestResult(database.transaction(keyStore, "readonly").objectStore(keyStore).getAllKeys())) as string[];
  for (const id of keys) if (id.startsWith("account:")) await deleteKey(id);
}

/* ---- Lo que hace la interfaz -------------------------------------------------------------------------------- */

/**
 * Guarda (o deja de guardar) una clave como pide `level`. Con `account` hace falta la llave de
 * la frase en este navegador; si no está, lanza `VaultLockedError` para pedirla.
 */
export async function rememberKey(provider: KeyProvider, apiKey: string, level: KeyPersistence) {
  const previous = state.levels[provider] ?? "tab";
  const userId = currentUser;
  if ((level === "session" || level === "account") && !userId) throw new Error("Inicia sesión en Pliegue para esta opción.");
  if (level === "account") {
    const cached = userId ? await readKey(accountKeyId(userId)) : null;
    if (!cached?.kdf) throw new VaultLockedError();
    if (apiKey) {
      await writeRemote(userId!, provider, await sealSecret(cached.key, apiKey, secretContext(provider, userId)), cached.kdf);
      await putSecret({ persistence: "account", provider, savedAt: new Date().toISOString(), sealed: await sealSecret(await deviceKey(), apiKey, secretContext(provider, userId)), userId });
      emit({ account: { ...state.account, remote: [...new Set([...state.account.remote, provider])] } });
    }
  } else if (level === "tab" || !apiKey) {
    await deleteSecret(provider);
  } else {
    const owner = level === "session" ? userId : null;
    await putSecret({ persistence: level, provider, savedAt: new Date().toISOString(), sealed: await sealSecret(await deviceKey(), apiKey, secretContext(provider, owner)), userId: owner });
  }
  // Al dejar de guardarla en la cuenta, se quita de allí.
  if (previous === "account" && level !== "account" && userId) {
    await deleteRemote(userId, provider);
    emit({ account: { ...state.account, remote: state.account.remote.filter((item) => item !== provider) } });
  }
  writeLevel(provider, level);
  emit({ error: null });
}

/** «Olvidar»: la clave sale de la memoria, de este navegador y, si estaba, de la cuenta. */
export async function forgetKey(provider: KeyProvider) {
  clearSessionApiKey(provider);
  await deleteSecret(provider);
  if (currentUser && state.account.remote.includes(provider)) {
    await deleteRemote(currentUser, provider);
    emit({ account: { ...state.account, remote: state.account.remote.filter((item) => item !== provider) } });
  }
}

/** Primera vez: crea la llave de la frase para esta cuenta (la sal va con cada clave guardada). */
export async function createAccountVault(passphrase: string) {
  if (!currentUser) throw new Error("Inicia sesión en Pliegue para guardar claves en tu cuenta.");
  const kdf = newPassphraseKdf();
  await putKey({ id: accountKeyId(currentUser), kdf, key: await derivePassphraseKey(passphrase, kdf) });
  emit({ account: { ...state.account, unlocked: true } });
}

/**
 * En otro equipo: con la frase, abre las claves de la cuenta. Devuelve un mensaje si la frase
 * no es la buena (AES-GCM no descifra), o null si se abrieron.
 */
export async function unlockAccountVault(passphrase: string): Promise<string | null> {
  const userId = currentUser;
  if (!userId) return "Inicia sesión en Pliegue para abrir las claves de tu cuenta.";
  const rows = await readRemote(userId);
  const kdf = rows.map((row) => row.kdf).find(isPassphraseKdf);
  if (!rows.length || !kdf) {
    await createAccountVault(passphrase);
    return null;
  }
  const key = await derivePassphraseKey(passphrase, kdf);
  try {
    await openRemoteRows(userId, rows.filter((row) => isSealedSecret({ data: row.ciphertext, iv: row.iv })), key);
  } catch {
    return "Esa no es la frase. Escríbela tal como la creaste (cuentan las mayúsculas y los espacios).";
  }
  await putKey({ id: accountKeyId(userId), kdf, key });
  emit({ account: { remote: rows.map((row) => row.provider as KeyProvider), unlocked: true, userId }, error: null });
  return null;
}

/** «Olvidé la frase»: borra las claves de la cuenta (sin la frase no sirven) y su llave aquí. */
export async function resetAccountVault() {
  const userId = currentUser;
  if (!userId) return;
  await deleteRemote(userId);
  await deleteKey(accountKeyId(userId));
  const levels = { ...state.levels };
  for (const record of await readSecrets()) {
    if (record.persistence !== "account") continue;
    await deleteSecret(record.provider);
    clearSessionApiKey(record.provider);
    delete levels[record.provider];
  }
  try {
    localStorage.setItem(levelsStorageKey, JSON.stringify(levels));
  } catch {
    // Sin almacenamiento, nada que guardar.
  }
  emit({ account: { remote: [], unlocked: false, userId }, levels });
}

/**
 * Antes de cerrar sesión: fuera de este navegador las claves de «hasta cerrar sesión» y la copia
 * de las de la cuenta, y la llave de la frase. Las de la pestaña y las de «en este navegador» se
 * quedan.
 */
export async function forgetSessionKeys() {
  if (typeof indexedDB === "undefined") return;
  const levels = { ...state.levels };
  for (const record of await readSecrets()) {
    if (record.persistence === "browser") continue;
    await deleteSecret(record.provider);
    clearSessionApiKey(record.provider);
    delete levels[record.provider];
  }
  await forgetAccountKeys();
  currentUser = null;
  emit({ account: { remote: [], unlocked: false, userId: null }, levels });
}

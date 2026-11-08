import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * La bóveda de claves (02.5) de punta a punta en el navegador, con IndexedDB simulado y una
 * tabla `user_secrets` en memoria. «Recargar» es volver a importar los módulos con el mismo
 * IndexedDB; «otro equipo», con uno nuevo.
 */

interface Row {
  ciphertext: string;
  iv: string;
  kdf: unknown;
  provider: string;
  user_id: string;
}
const table: Row[] = [];
const requests: unknown[] = [];

function query() {
  const filters: Array<[string, string]> = [];
  let action: "select" | "delete" = "select";
  const builder = {
    delete() {
      action = "delete";
      return builder;
    },
    eq(column: string, value: string) {
      filters.push([column, value]);
      return builder;
    },
    select() {
      return builder;
    },
    then(resolve: (value: { data: Row[] | null; error: null }) => void) {
      const match = (row: Row) => filters.every(([column, value]) => row[column as keyof Row] === value);
      if (action === "delete") {
        for (let index = table.length - 1; index >= 0; index -= 1) if (match(table[index]!)) table.splice(index, 1);
        resolve({ data: null, error: null });
      } else resolve({ data: table.filter(match).map((row) => ({ ...row })), error: null });
    },
    upsert(row: Row) {
      requests.push(row);
      const index = table.findIndex((item) => item.user_id === row.user_id && item.provider === row.provider);
      if (index >= 0) table[index] = row;
      else table.push(row);
      return Promise.resolve({ error: null });
    },
  };
  return builder;
}

vi.mock("../cloud/supabase-client", () => ({ cloudClient: () => ({ from: () => query() }) }));

const memory = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => memory.get(key) ?? null,
  removeItem: (key: string) => memory.delete(key),
  setItem: (key: string, value: string) => memory.set(key, value),
});

const apiKey = "sk-ant-api03-clave-de-prueba-0000000000000000";
const geminiKey = "AIzaSy-clave-de-gemini-de-prueba-000000000";
const passphrase = "una frase larga que solo yo sé";

/** Una pestaña nueva de la app: módulos recién cargados, el IndexedDB que haya. */
async function open() {
  vi.resetModules();
  const vault = await import("./key-vault");
  const secrets = await import("./ai-session-secret-store");
  return { secrets, vault };
}

async function stored() {
  const all = await new Promise<unknown[]>((resolve) => {
    const request = indexedDB.open("pliegue-key-vault");
    request.onsuccess = () => {
      const get = request.result.transaction("secrets").objectStore("secrets").getAll();
      get.onsuccess = () => {
        resolve(get.result);
        request.result.close();
      };
    };
  });
  return all as Array<{ persistence: string; provider: string; sealed: { data: string } }>;
}

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  table.length = 0;
  requests.length = 0;
  memory.clear();
});

describe("bóveda de claves en el navegador (02.5)", () => {
  it("«solo esta pestaña»: no se guarda nada y al recargar ya no está", async () => {
    let { secrets, vault } = await open();
    await vault.syncKeyVault(null);
    secrets.setSessionApiKey("anthropic", apiKey);
    await vault.rememberKey("anthropic", apiKey, "tab");
    expect(await stored()).toEqual([]);
    ({ secrets, vault } = await open());
    await vault.syncKeyVault(null);
    expect(secrets.getSessionApiKey("anthropic")).toBe("");
  });

  it("«en este navegador»: se guarda cifrada y vuelve al recargar, con o sin cuenta", async () => {
    let { secrets, vault } = await open();
    await vault.syncKeyVault(null);
    await vault.rememberKey("anthropic", apiKey, "browser");
    const records = await stored();
    expect(records).toHaveLength(1);
    expect(JSON.stringify(records)).not.toContain("sk-ant");
    ({ secrets, vault } = await open());
    await vault.syncKeyVault("cuenta-a");
    expect(secrets.getSessionApiKey("anthropic")).toBe(apiKey);
    expect(vault.readKeyVault().levels.anthropic).toBe("browser");
  });

  it("«hasta cerrar sesión»: vuelve al recargar con la sesión, y se va al cerrarla", async () => {
    let { secrets, vault } = await open();
    await vault.syncKeyVault("cuenta-a");
    await vault.rememberKey("gemini", geminiKey, "session");
    ({ secrets, vault } = await open());
    await vault.syncKeyVault("cuenta-a");
    expect(secrets.getSessionApiKey("gemini")).toBe(geminiKey);
    await vault.forgetSessionKeys();
    expect(secrets.getSessionApiKey("gemini")).toBe("");
    expect(await stored()).toEqual([]);
  });

  it("si la sesión ya no es de esa cuenta (cerrada en otra pestaña), se borra al cargar", async () => {
    let { secrets, vault } = await open();
    await vault.syncKeyVault("cuenta-a");
    await vault.rememberKey("gemini", geminiKey, "session");
    await vault.rememberKey("anthropic", apiKey, "browser");
    ({ secrets, vault } = await open());
    await vault.syncKeyVault("cuenta-b");
    expect(secrets.getSessionApiKey("gemini")).toBe("");
    expect(secrets.getSessionApiKey("anthropic")).toBe(apiKey);
    expect((await stored()).map((record) => record.persistence)).toEqual(["browser"]);
  });

  it("sin sesión no se ofrece guardar hasta cerrar sesión ni en la cuenta", async () => {
    const { vault } = await open();
    await vault.syncKeyVault(null);
    await expect(vault.rememberKey("gemini", geminiKey, "session")).rejects.toThrow(/Inicia sesión/);
    await expect(vault.rememberKey("gemini", geminiKey, "account")).rejects.toThrow(/Inicia sesión/);
  });

  it("«en mi cuenta»: pide la frase, sube solo texto cifrado y en otro equipo se abre con ella", async () => {
    let { secrets, vault } = await open();
    await vault.syncKeyVault("cuenta-a");
    await expect(vault.rememberKey("anthropic", apiKey, "account")).rejects.toBeInstanceOf(vault.VaultLockedError);
    await vault.createAccountVault(passphrase);
    await vault.rememberKey("anthropic", apiKey, "account");
    expect(table).toHaveLength(1);
    expect(table[0]).toMatchObject({ provider: "anthropic", user_id: "cuenta-a" });
    expect(JSON.stringify(requests)).not.toContain("sk-ant");
    expect(JSON.stringify(requests)).not.toContain(passphrase);

    // Al recargar en este equipo no la vuelve a pedir: la llave de la frase se quedó aquí.
    ({ secrets, vault } = await open());
    await vault.syncKeyVault("cuenta-a");
    expect(secrets.getSessionApiKey("anthropic")).toBe(apiKey);
    expect(vault.readKeyVault().account.unlocked).toBe(true);

    // Otro equipo: la cuenta tiene la clave, pero hasta escribir la frase no se puede leer.
    vi.stubGlobal("indexedDB", new IDBFactory());
    ({ secrets, vault } = await open());
    await vault.syncKeyVault("cuenta-a");
    expect(vault.readKeyVault().account).toMatchObject({ remote: ["anthropic"], unlocked: false });
    expect(secrets.getSessionApiKey("anthropic")).toBe("");
    expect(await vault.unlockAccountVault("no es la frase")).toMatch(/Esa no es la frase/);
    expect(secrets.getSessionApiKey("anthropic")).toBe("");
    expect(await vault.unlockAccountVault(passphrase)).toBeNull();
    expect(secrets.getSessionApiKey("anthropic")).toBe(apiKey);
    expect(vault.readKeyVault().levels.anthropic).toBe("account");
  }, 30_000);

  it("al cerrar sesión, la copia de la cuenta y la llave de la frase se van de este equipo", async () => {
    let { secrets, vault } = await open();
    await vault.syncKeyVault("cuenta-a");
    await vault.createAccountVault(passphrase);
    await vault.rememberKey("anthropic", apiKey, "account");
    await vault.forgetSessionKeys();
    expect(secrets.getSessionApiKey("anthropic")).toBe("");
    expect(table).toHaveLength(1);
    ({ secrets, vault } = await open());
    await vault.syncKeyVault("cuenta-a");
    expect(vault.readKeyVault().account.unlocked).toBe(false);
    expect(secrets.getSessionApiKey("anthropic")).toBe("");
  }, 30_000);

  it("«Olvidar» la borra también de la cuenta; «olvidé la frase» vacía la cuenta", async () => {
    const { secrets, vault } = await open();
    await vault.syncKeyVault("cuenta-a");
    await vault.createAccountVault(passphrase);
    await vault.rememberKey("anthropic", apiKey, "account");
    await vault.rememberKey("gemini", geminiKey, "account");
    await vault.forgetKey("anthropic");
    expect(table.map((row) => row.provider)).toEqual(["gemini"]);
    expect(secrets.getSessionApiKey("anthropic")).toBe("");
    await vault.resetAccountVault();
    expect(table).toEqual([]);
    expect(vault.readKeyVault().account).toMatchObject({ remote: [], unlocked: false });
  }, 30_000);

  it("pasar de la cuenta a otro nivel la quita de la cuenta", async () => {
    const { vault } = await open();
    await vault.syncKeyVault("cuenta-a");
    await vault.createAccountVault(passphrase);
    await vault.rememberKey("anthropic", apiKey, "account");
    await vault.rememberKey("anthropic", apiKey, "browser");
    expect(table).toEqual([]);
    expect((await stored()).map((record) => record.persistence)).toEqual(["browser"]);
  }, 30_000);
});

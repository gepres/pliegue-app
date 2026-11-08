import { describe, expect, it } from "vitest";

import {
  createDeviceKey,
  derivePassphraseKey,
  fromBase64,
  isPassphraseKdf,
  newPassphraseKdf,
  openSecret,
  passphraseIssue,
  passphraseIterations,
  sealSecret,
  secretContext,
} from "./key-vault-crypto";

const apiKey = "sk-ant-api03-clave-de-prueba-0000000000000000";

describe("cifrado de la bóveda de claves (02.5)", () => {
  it("la llave del navegador cifra y descifra, y no se puede exportar", async () => {
    const key = await createDeviceKey();
    const sealed = await sealSecret(key, apiKey, secretContext("anthropic"));
    expect(await openSecret(key, sealed, secretContext("anthropic"))).toBe(apiKey);
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw", key)).rejects.toThrow();
  });

  it("lo cifrado no deja ver la clave, y cada cifrado es distinto", async () => {
    const key = await createDeviceKey();
    const first = await sealSecret(key, apiKey, secretContext("anthropic"));
    const second = await sealSecret(key, apiKey, secretContext("anthropic"));
    expect(first.data).not.toBe(second.data);
    expect(first.iv).not.toBe(second.iv);
    expect(fromBase64(first.iv)).toHaveLength(12);
    const raw = new TextDecoder("latin1").decode(fromBase64(first.data));
    expect(raw.includes("sk-ant")).toBe(false);
    expect(JSON.stringify(first).includes("sk-ant")).toBe(false);
  });

  it("un texto cifrado no sirve para otro proveedor ni para otra cuenta", async () => {
    const key = await createDeviceKey();
    const sealed = await sealSecret(key, apiKey, secretContext("anthropic", "cuenta-a"));
    await expect(openSecret(key, sealed, secretContext("openai", "cuenta-a"))).rejects.toThrow();
    await expect(openSecret(key, sealed, secretContext("anthropic", "cuenta-b"))).rejects.toThrow();
  });

  it("con la frase: la misma frase y sal abren en otro equipo; otra frase, no", async () => {
    const kdf = newPassphraseKdf();
    expect(kdf.iterations).toBe(passphraseIterations);
    expect(isPassphraseKdf(kdf)).toBe(true);
    const here = await derivePassphraseKey("una frase larga que solo yo sé", kdf);
    const sealed = await sealSecret(here, apiKey, secretContext("openai", "cuenta-a"));
    // Otro equipo: deriva de nuevo con la sal que guardó Supabase.
    const elsewhere = await derivePassphraseKey("una frase larga que solo yo sé", { ...kdf });
    expect(await openSecret(elsewhere, sealed, secretContext("openai", "cuenta-a"))).toBe(apiKey);
    const wrong = await derivePassphraseKey("otra frase cualquiera", kdf);
    await expect(openSecret(wrong, sealed, secretContext("openai", "cuenta-a"))).rejects.toThrow();
    expect(here.extractable).toBe(false);
  }, 20_000);

  it("pide una frase de al menos 10 caracteres, escrita igual dos veces", () => {
    expect(passphraseIssue("corta")).toMatch(/al menos 10/);
    expect(passphraseIssue("una frase larga", "una frase larga")).toBeNull();
    expect(passphraseIssue("una frase larga", "una frase larg")).toMatch(/no coinciden/);
    expect(isPassphraseKdf({ hash: "SHA-256", iterations: 1000, name: "PBKDF2", salt: "x" })).toBe(false);
  });
});

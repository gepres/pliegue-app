import { describe, expect, it } from "vitest";

import type { LibraryDocument } from "./documents";
import { effectiveSensitivity, isLoopbackUrl, providerPlace, routeFor, sourceKeyOf } from "./sensitivity";

const doc = (id: string, reference: LibraryDocument["reference"], extra: Record<string, unknown> = {}) =>
  ({ id, reference, ...extra }) as Pick<LibraryDocument, "id" | "reference">;

describe("de qué fuente sale un libro", () => {
  it("cada origen tiene su clave", () => {
    expect(sourceKeyOf(doc("a", { kind: "local-folder", relativePath: "x/y.pdf", sourceId: "f1" }))).toBe("folder:f1");
    expect(sourceKeyOf(doc("b", { kind: "local-file", referenceId: "r" }))).toBe("files");
    expect(sourceKeyOf(doc("c", { kind: "local-copy", storageId: "s" }))).toBe("copies");
    expect(sourceKeyOf(doc("d", { fileId: "1", kind: "google-drive" }, { sourceId: "d1" }))).toBe("drive:d1");
    expect(sourceKeyOf(doc("e", { fileId: "2", kind: "google-drive" }, { sourceId: null }))).toBe("drive-files");
  });
});

describe("la sensibilidad que vale", () => {
  const book = doc("libro", { kind: "local-folder", relativePath: "Diario.pdf", sourceId: "privada" });

  it("sin marcar, interno: no cambia nada de lo que había", () => {
    expect(effectiveSensitivity(book, { documents: {}, sources: {} })).toBe("interno");
  });

  it("hereda la de su fuente", () => {
    expect(effectiveSensitivity(book, { documents: {}, sources: { "folder:privada": "confidencial" } })).toBe("confidencial");
  });

  it("la del libro manda sobre la de su fuente", () => {
    expect(effectiveSensitivity(book, { documents: { libro: "publico" }, sources: { "folder:privada": "confidencial" } })).toBe("publico");
  });
});

describe("qué hacer antes de enviar un libro", () => {
  it("en el equipo, siempre se puede", () => {
    expect(routeFor("confidencial", "device", false)).toBe("allow");
  });

  it("confidencial no sale nunca", () => {
    expect(routeFor("confidencial", "cloud", true)).toBe("block");
  });

  it("personal pregunta una vez; con permiso, sigue", () => {
    expect(routeFor("personal", "cloud", false)).toBe("ask");
    expect(routeFor("personal", "cloud", true)).toBe("allow");
  });

  it("público e interno, como siempre", () => {
    expect(routeFor("publico", "cloud", false)).toBe("allow");
    expect(routeFor("interno", "cloud", false)).toBe("allow");
  });
});

describe("dónde trabaja cada proveedor", () => {
  const settings = { libreTranslateUrl: "https://libretranslate.com", ollamaMode: "local" as const, ollamaUrl: "http://localhost:11434" };

  it("el navegador y Ollama en este equipo, dentro; los alojados, fuera", () => {
    expect(providerPlace("browser", settings)).toBe("device");
    expect(providerPlace("ollama", settings)).toBe("device");
    expect(providerPlace("openai", settings)).toBe("cloud");
    expect(providerPlace("deepl", settings)).toBe("cloud");
  });

  it("Ollama en otro servidor sale del equipo; en localhost, no", () => {
    expect(providerPlace("ollama", { ...settings, ollamaMode: "remote", ollamaUrl: "https://ollama.mi-servidor.net" })).toBe("cloud");
    expect(providerPlace("ollama", { ...settings, ollamaMode: "remote", ollamaUrl: "http://127.0.0.1:11434" })).toBe("device");
  });

  it("LibreTranslate en este equipo no saca nada", () => {
    expect(providerPlace("libretranslate", settings)).toBe("cloud");
    expect(providerPlace("libretranslate", { ...settings, libreTranslateUrl: "http://localhost:5000" })).toBe("device");
    expect(isLoopbackUrl("http://libros.localhost:5000")).toBe(true);
    expect(isLoopbackUrl("no es una dirección")).toBe(false);
  });
});

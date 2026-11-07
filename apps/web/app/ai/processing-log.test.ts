import { describe, expect, it } from "vitest";

import type { OpenTranslator } from "../library/translation-engine";
import {
  addProcessing,
  auditRoute,
  auditTranslator,
  dayKey,
  engineIdentity,
  matchesFilter,
  pairBelongsToEngine,
  parseProcessingLog,
  processingExport,
  pruneProcessing,
  summarizeProcessing,
  type ProcessingEntry,
  type ProcessingEvent,
} from "./processing-log";

const base: ProcessingEvent = {
  documentId: "doc-1",
  flow: "catalog",
  model: "gemini-3.5-flash-lite",
  place: "cloud",
  provider: "gemini",
  route: "allowed",
  sensitivity: "interno",
};

const at = (iso: string) => new Date(iso);

describe("registro de la IA (04.6)", () => {
  it("junta lo de un libro con el mismo proveedor y flujo en el mismo día", () => {
    let log: ProcessingEntry[] = [];
    log = addProcessing(log, { ...base, characters: 1200, sent: 1, tokens: 900 }, at("2026-11-06T10:00:00"));
    log = addProcessing(log, { ...base, characters: 800, sent: 1, tokens: 600 }, at("2026-11-06T18:00:00"));
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ characters: 2000, sent: 2, tokens: 1500 });
    expect(log[0]?.firstAt).toBe(at("2026-11-06T10:00:00").toISOString());
    expect(log[0]?.lastAt).toBe(at("2026-11-06T18:00:00").toISOString());
  });

  it("separa por día, proveedor, modelo y decisión del router", () => {
    let log: ProcessingEntry[] = [];
    log = addProcessing(log, { ...base, sent: 1 }, at("2026-11-06T10:00:00"));
    log = addProcessing(log, { ...base, sent: 1 }, at("2026-11-07T10:00:00"));
    log = addProcessing(log, { ...base, provider: "openai", model: "gpt-6-luna", sent: 1 }, at("2026-11-07T11:00:00"));
    log = addProcessing(log, { ...base, route: "kept-local", sensitivity: "confidencial" }, at("2026-11-07T12:00:00"));
    expect(log).toHaveLength(4);
    // La más reciente, primero.
    expect(log[0]?.route).toBe("kept-local");
  });

  it("no guarda nada que no sean cifras: ni textos ni claves", () => {
    const log = addProcessing(
      [],
      { ...base, characters: 10, sent: 1, ...({ text: "secreto", apiKey: "sk-123" } as object) } as ProcessingEvent,
      at("2026-11-06T10:00:00"),
    );
    const serialized = JSON.stringify(log);
    expect(serialized).not.toContain("secreto");
    expect(serialized).not.toContain("sk-123");
  });

  it("caduca a los 90 días y se queda con las 1.000 más recientes", () => {
    const now = at("2026-11-06T12:00:00");
    let log: ProcessingEntry[] = [];
    log = addProcessing(log, { ...base, documentId: "viejo" }, at("2026-08-01T12:00:00"));
    log = addProcessing(log, { ...base, documentId: "justo" }, at("2026-08-08T12:00:00"));
    log = addProcessing(log, { ...base, documentId: "nuevo" }, at("2026-11-05T12:00:00"));
    expect(pruneProcessing(log, now).map((entry) => entry.documentId)).toEqual(["nuevo", "justo"]);
    expect(pruneProcessing(log, now, { maxEntries: 1 }).map((entry) => entry.documentId)).toEqual(["nuevo"]);
  });

  it("lee lo guardado sin fiarse", () => {
    const good = addProcessing([], { ...base, sent: 1 }, at("2026-11-06T10:00:00"))[0];
    const parsed = parseProcessingLog([
      good,
      null,
      { ...good, flow: "inventado" },
      { ...good, route: "cualquiera" },
      { ...good, day: "ayer" },
      { ...good, documentId: "" },
      { ...good, sensitivity: "rara", sent: -3, tokens: "mucho" },
    ]);
    expect(parsed).toHaveLength(2);
    expect(parsed[1]).toMatchObject({ sensitivity: "interno", sent: 0, tokens: 0 });
    expect(parseProcessingLog("no es una lista")).toEqual([]);
  });

  it("dice qué decidió el router de sensibilidad", () => {
    expect(auditRoute("block", "confidencial", "cloud")).toBe("kept-local");
    expect(auditRoute("ask", "personal", "cloud")).toBe("needs-consent");
    expect(auditRoute("allow", "personal", "cloud")).toBe("consented");
    expect(auditRoute("allow", "personal", "device")).toBe("allowed");
    expect(auditRoute("allow", "publico", "cloud")).toBe("allowed");
  });

  it("filtra y resume por dónde se procesó cada libro", () => {
    let log: ProcessingEntry[] = [];
    const now = at("2026-11-06T10:00:00");
    log = addProcessing(log, { ...base, documentId: "a", sent: 1 }, now);
    log = addProcessing(log, { ...base, documentId: "a", flow: "translate", provider: "openai", model: "gpt-6-luna", sent: 3 }, now);
    log = addProcessing(log, { ...base, documentId: "b", place: "device", provider: "browser", model: null, sent: 1 }, now);
    log = addProcessing(log, { ...base, documentId: "c", route: "kept-local", sensitivity: "confidencial" }, now);
    expect(summarizeProcessing(log)).toEqual({ cloudBooks: 1, cloudProviders: ["gemini", "openai"], deviceBooks: 1, keptBooks: 1 });
    expect(log.filter((entry) => matchesFilter(entry, "cloud"))).toHaveLength(2);
    expect(log.filter((entry) => matchesFilter(entry, "device")).map((entry) => entry.documentId)).toEqual(["b"]);
    expect(log.filter((entry) => matchesFilter(entry, "kept")).map((entry) => entry.documentId)).toEqual(["c"]);
    expect(log.filter((entry) => matchesFilter(entry, "all"))).toHaveLength(4);
  });

  it("descarga el registro con el título de hoy, sin claves internas", () => {
    const log = addProcessing([], { ...base, sent: 1 }, at("2026-11-06T10:00:00"));
    const exported = processingExport(log, (id) => (id === "doc-1" ? "Ficciones" : null), at("2026-11-06T11:00:00"));
    expect(exported.entries[0]).toMatchObject({ documentId: "doc-1", provider: "gemini", title: "Ficciones" });
    expect(exported.entries[0]).not.toHaveProperty("key");
    expect(exported.retentionDays).toBe(90);
  });

  it("sabe de qué motor es cada traducción guardada", () => {
    expect(pairBelongsToEngine("ai:ollama:qwen3:8b:en>es", "ai:ollama:qwen3:8b")).toBe(true);
    expect(pairBelongsToEngine("ai:ollama:qwen3:8b:en>es", "ai:ollama:qwen3")).toBe(false);
    expect(pairBelongsToEngine("browser:en>es", "browser")).toBe(true);
    expect(pairBelongsToEngine("ai:openai:gpt-6-luna:pt-BR>es", "ai:openai:gpt-6-luna")).toBe(true);
    expect(pairBelongsToEngine("ai:openai:gpt-6-luna:en>es", "ai:openai:gpt-6")).toBe(false);
    expect(engineIdentity("ai:ollama:qwen3:8b")).toEqual({ model: "qwen3:8b", provider: "ollama" });
    expect(engineIdentity("ai:libretranslate")).toEqual({ model: null, provider: "libretranslate" });
    expect(engineIdentity("browser")).toEqual({ model: null, provider: "browser" });
  });

  it("cuenta lo que se manda al traductor y avisa de los fallos, no de lo cancelado", async () => {
    const failures: number[] = [];
    let fail: Error | null = null;
    const translator: OpenTranslator = {
      destroy: () => {},
      translate: async (text) => {
        if (fail) throw fail;
        return text.toUpperCase();
      },
      translateMany: async (texts) => {
        if (fail) throw fail;
        return texts.map((text) => text.toUpperCase());
      },
    };
    const audited = auditTranslator(translator, (characters) => failures.push(characters));
    await audited.translator.translate("hola");
    await audited.translator.translateMany?.(["uno", "dos"]);
    expect(audited.flush()).toBe(10);
    expect(audited.flush()).toBe(0);
    fail = new Error("429");
    await expect(audited.translator.translateMany?.(["abc"])).rejects.toThrow("429");
    fail = Object.assign(new Error("parado"), { name: "AbortError" });
    await expect(audited.translator.translate("xyz")).rejects.toThrow("parado");
    expect(failures).toEqual([3]);
    expect(audited.flush()).toBe(0);
  });

  it("el día es el local", () => {
    expect(dayKey(new Date(2026, 0, 5, 23, 30))).toBe("2026-01-05");
  });
});

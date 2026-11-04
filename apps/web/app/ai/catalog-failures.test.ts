import { describe, expect, it } from "vitest";

import { groupCatalogFailures, unexplainedCatalogFailure } from "./catalog-failures";
import type { DocumentCatalogRecord } from "./document-catalog";

const quota = "Gemini rechazó la solicitud por límite de uso o saldo agotado. Inténtalo más tarde.";

function record(documentId: string, overrides: Partial<DocumentCatalogRecord> = {}): DocumentCatalogRecord {
  return {
    analyzedAt: "2026-11-04T18:00:00.000Z",
    catalog: null,
    documentId,
    error: quota,
    inputFingerprint: `huella-${documentId}`,
    model: "gemini-3.5-flash-lite",
    provider: "gemini",
    schemaVersion: 1,
    status: "error",
    ...overrides,
  };
}

const titles = new Map([
  ["a", "Zaratustra"],
  ["b", "Ética"],
  ["c", "Árbol de la ciencia"],
  ["d", "Los ríos profundos"],
]);
const titleOf = (id: string) => titles.get(id);

describe("groupCatalogFailures", () => {
  it("junta bajo un mismo motivo los documentos que lo comparten, con sus títulos en orden", () => {
    const groups = groupCatalogFailures([record("a"), record("b"), record("c")], titleOf);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      message: quota,
      model: "gemini-3.5-flash-lite",
      provider: "gemini",
      titles: ["Árbol de la ciencia", "Ética", "Zaratustra"],
    });
  });

  it("separa los motivos, y también el mismo mensaje con otro proveedor o modelo", () => {
    const groups = groupCatalogFailures(
      [
        record("a"),
        record("b", { error: "La API key de OpenAI no es válida.", model: "gpt-6-luna", provider: "openai" }),
        record("c", { model: "gemini-3.5-flash" }),
      ],
      titleOf,
    );

    expect(groups.map((group) => [group.provider, group.model, group.titles])).toEqual(
      expect.arrayContaining([
        ["gemini", "gemini-3.5-flash-lite", ["Zaratustra"]],
        ["openai", "gpt-6-luna", ["Ética"]],
        ["gemini", "gemini-3.5-flash", ["Árbol de la ciencia"]],
      ]),
    );
    expect(groups).toHaveLength(3);
  });

  it("solo cuenta los errores: ni lo catalogado, ni lo que espera texto, ni lo que está en curso", () => {
    const groups = groupCatalogFailures(
      [
        record("a", { error: null, status: "analyzed" }),
        record("b", { error: "Este archivo no tiene texto local.", status: "needs-content" }),
        record("c", { error: null, status: "analyzing" }),
        record("d"),
      ],
      titleOf,
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.titles).toEqual(["Los ríos profundos"]);
  });

  it("deja fuera la ficha de un documento que ya no está en la biblioteca", () => {
    expect(groupCatalogFailures([record("quitado")], titleOf)).toEqual([]);
  });

  it("sin mensaje guardado, lo dice en vez de dejar el motivo en blanco", () => {
    const [group] = groupCatalogFailures([record("a", { error: null }), record("b", { error: "  " })], titleOf);

    expect(group?.message).toBe(unexplainedCatalogFailure);
    expect(group?.titles).toHaveLength(2);
  });

  it("pone primero el motivo del intento más reciente", () => {
    const groups = groupCatalogFailures(
      [
        record("a", { analyzedAt: "2026-11-03T10:00:00.000Z", error: "Antiguo." }),
        record("b", { analyzedAt: "2026-11-04T10:00:00.000Z", error: "Reciente." }),
      ],
      titleOf,
    );

    expect(groups.map((group) => group.message)).toEqual(["Reciente.", "Antiguo."]);
  });
});

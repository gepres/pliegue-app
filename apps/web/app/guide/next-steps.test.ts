import { describe, expect, it } from "vitest";

import { afterAiReady, afterCatalog, afterJsonImport, afterLibraryGrowth } from "./next-steps";

const ready = { providerName: "Gemini", ready: true };
const notReady = { providerName: "OpenAI", ready: false };

function labels(step: ReturnType<typeof afterLibraryGrowth>) {
  return step?.actions.map((action) => `${action.primary ? "★ " : ""}${action.label} → ${action.href}`);
}

describe("siguiente paso", () => {
  it("tras añadir documentos, cataloga si hay IA y, si no, lleva a configurarla", () => {
    expect(labels(afterLibraryGrowth({ added: 3, ai: ready, folderName: "Ensayos" }))).toEqual([
      "★ Catalogar con IA → /app/ia",
      "Importar un índice JSON → /app/biblioteca/fuentes#indice-json",
      "Ver la Biblioteca → /app/biblioteca",
    ]);
    expect(afterLibraryGrowth({ added: 3, ai: ready, folderName: "Ensayos" })?.title).toBe(
      "«Ensayos» ya está en tu biblioteca",
    );
    expect(labels(afterLibraryGrowth({ added: 1, ai: notReady }))?.[0]).toBe(
      "★ Configurar una IA para catalogar → /app/ajustes#ia",
    );
    expect(afterLibraryGrowth({ added: 1, ai: notReady })?.title).toBe("1 documento nuevo");
    // Sin nada nuevo no hay nada que sugerir.
    expect(afterLibraryGrowth({ added: 0, ai: ready })).toBeNull();
  });

  it("con la IA lista, propone catalogar lo pendiente, o añadir documentos si no hay", () => {
    expect(afterAiReady({ documents: 10, pending: 4, providerName: "Gemini" })?.actions[0]).toMatchObject({
      href: "/app/ia",
      label: "Catalogar 4 documentos",
    });
    expect(afterAiReady({ documents: 0, pending: 0, providerName: "Gemini" })?.actions[0]?.href).toBe(
      "/app/biblioteca/fuentes#carpetas",
    );
    // Todo catalogado: no se molesta.
    expect(afterAiReady({ documents: 10, pending: 0, providerName: "Gemini" })).toBeNull();
  });

  it("tras catalogar, lleva a la Biblioteca y nombra las primeras categorías", () => {
    const step = afterCatalog({ analyzed: 5, categories: ["Historia", "Filosofía", "Literatura", "Arte"] });
    expect(step?.title).toBe("5 fichas nuevas");
    expect(step?.description).toBe("La biblioteca ya se ordena por materias: Historia, Filosofía, Literatura…");
    expect(step?.actions[0]?.href).toBe("/app/biblioteca");
    expect(afterCatalog({ analyzed: 0, categories: [] })).toBeNull();
  });

  it("tras un índice JSON, ofrece completar con IA solo lo que falta", () => {
    expect(afterJsonImport({ ai: ready, matched: 3, missing: 0 })?.actions).toHaveLength(1);
    expect(afterJsonImport({ ai: ready, matched: 3, missing: 2 })?.actions[1]).toMatchObject({
      href: "/app/ia",
      label: "Catalogar con IA lo que falta",
    });
    expect(afterJsonImport({ ai: notReady, matched: 3, missing: 2 })?.actions[1]?.href).toBe("/app/ajustes#ia");
  });
});

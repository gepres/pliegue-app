import { describe, expect, it } from "vitest";

import { hashText, type TranslatedBlock } from "./translation";
import type { OpenTranslator } from "./translation-engine";
import { TranslationSession, type TranslationStorage } from "./translation-session";

/** Un libro de mentira: cada página dice su número. */
const page = (unit: number) => ({ blocks: [{ text: `Page ${unit} text` }] });

function setup({
  failing = false,
  pages = 20,
  stored = new Map<string, TranslatedBlock[]>(),
}: { failing?: boolean; pages?: number; stored?: Map<string, TranslatedBlock[]> } = {}) {
  const calls: string[] = [];
  let destroyed = false;
  const translator: OpenTranslator = {
    destroy: () => {
      destroyed = true;
    },
    translate: async (text) => {
      calls.push(text);
      if (failing) throw new Error("El paquete de idioma no está.");
      return `ES ${text}`;
    },
  };
  const storage: TranslationStorage = {
    read: async (id) => stored.get(id) ?? null,
    write: async (id, blocks) => {
      stored.set(id, blocks);
    },
  };
  const session = new TranslationSession({
    loadUnit: async (unit) => page(unit),
    pagesAhead: 3,
    storage,
    storedIds: new Set(stored.keys()),
    translator,
    unitCount: pages,
    unitId: (unit) => `page:${unit}`,
  });
  return { calls, destroyed: () => destroyed, session, stored };
}

/** Espera a que la sesión no tenga nada en marcha ni en cola. */
function idle(session: TranslationSession<{ text: string }>) {
  return new Promise<void>((resolve) => {
    const check = () => {
      const snapshot = session.getSnapshot();
      if (snapshot.working === null && (snapshot.pending.length === 0 || snapshot.error)) resolve();
    };
    session.subscribe(check);
    setTimeout(check, 0);
  });
}

describe("sesión de traducción de un libro", () => {
  it("traduce la página actual y prepara las siguientes", async () => {
    const { calls, session, stored } = setup();
    session.setCurrent(5);
    await idle(session);

    expect(calls).toEqual(["Page 5 text", "Page 6 text", "Page 7 text", "Page 8 text"]);
    expect(session.unit(5)?.translated[0]?.text).toBe("ES Page 5 text");
    expect([...stored.keys()]).toEqual(["page:5", "page:6", "page:7", "page:8"]);
    expect(session.getSnapshot()).toMatchObject({ done: 4, percent: 20, working: null });
  });

  it("reutiliza lo guardado si el original no cambió y retraduce si cambió", async () => {
    const stored = new Map<string, TranslatedBlock[]>([
      ["page:1", [{ hash: hashText("Page 1 text"), text: "Guardada 1" }]],
      ["page:2", [{ hash: hashText("Otra versión"), text: "Obsoleta 2" }]],
    ]);
    const { calls, session } = setup({ stored });
    session.setCurrent(1);
    await idle(session);

    expect(session.unit(1)?.translated[0]?.text).toBe("Guardada 1");
    expect(session.unit(2)?.translated[0]?.text).toBe("ES Page 2 text");
    expect(calls).not.toContain("Page 1 text");
  });

  it("rehace la cola cuando se salta a otra parte del libro", async () => {
    const { calls, session } = setup();
    session.setCurrent(2);
    await idle(session);
    session.setCurrent(15);
    await idle(session);

    expect(calls.slice(-4)).toEqual(["Page 15 text", "Page 16 text", "Page 17 text", "Page 18 text"]);
  });

  it("se para tras varios fallos seguidos y deja reintentar", async () => {
    const { session } = setup({ failing: true });
    session.setCurrent(1);
    await idle(session);

    const snapshot = session.getSnapshot();
    expect(snapshot.error).toMatch(/paquete de idioma/);
    expect(snapshot.failed.size).toBe(3);
    session.retry();
    expect(session.getSnapshot().error).toBeNull();
  });

  it("al cerrarla suelta el traductor", () => {
    const { destroyed, session } = setup();
    session.dispose();
    expect(destroyed()).toBe(true);
  });
});

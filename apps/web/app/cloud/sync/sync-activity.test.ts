import { describe, expect, it } from "vitest";

import type { LibraryDocument } from "../../library/documents";
import {
  activityFromSummary,
  countBooks,
  describeActivity,
  describeChanges,
  recordActivity,
  syncedPercent,
  type SyncActivity,
} from "./sync-activity";
import type { CollectionCounts, SyncSummary } from "./sync-runner";

function counts(partial: Partial<CollectionCounts>): CollectionCounts {
  return { applied: 0, cloud: 0, disabled: false, local: 0, pushed: 0, waiting: 0, ...partial };
}

function summary(collections: Record<string, Partial<CollectionCounts>>): SyncSummary {
  return {
    applied: 0,
    booksWithState: 0,
    collections: Object.fromEntries(Object.entries(collections).map(([name, value]) => [name, counts(value)])),
    pulled: 0,
    pushed: 0,
  };
}

const checked = (at: string): SyncActivity => ({ applied: {}, at, kind: "checked", pushed: {} });

describe("registro de la sincronización", () => {
  it("una vuelta sin cambios es una comprobación; con cambios, cuenta lo que viajó", () => {
    expect(activityFromSummary(summary({ favorites: { local: 3 } }), "t1").kind).toBe("checked");
    const entry = activityFromSummary(summary({ annotations: { applied: 1 }, "reading-progress": { pushed: 2 } }), "t2");
    expect(entry).toMatchObject({ applied: { annotations: 1 }, kind: "changes", pushed: { "reading-progress": 2 } });
    expect(describeActivity(entry)).toBe("subidos 2: 2 avances · recibido 1: 1 nota");
  });

  it("las comprobaciones seguidas sin cambios se juntan en una línea", () => {
    let log = recordActivity([], checked("10:00"));
    log = recordActivity(log, checked("10:01"));
    log = recordActivity(log, checked("10:02"));
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ at: "10:02", checks: 3, since: "10:00" });
    expect(describeActivity(log[0]!)).toBe("comprobado 3 veces, sin cambios");

    log = recordActivity(log, { applied: {}, at: "10:03", kind: "changes", pushed: { favorites: 1 } });
    log = recordActivity(log, checked("10:04"));
    expect(log.map((entry) => entry.kind)).toEqual(["checked", "changes", "checked"]);
  });

  it("el registro guarda las últimas vueltas", () => {
    let log: SyncActivity[] = [];
    for (let index = 0; index < 12; index += 1) {
      log = recordActivity(log, { applied: {}, at: `t${index}`, kind: "changes", pushed: { favorites: 1 } }, 8);
    }
    expect(log).toHaveLength(8);
    expect(log[0]?.at).toBe("t11");
  });

  it("describe en singular y en plural", () => {
    expect(describeChanges({ applied: {}, pushed: { favorites: 1 } })).toBe("subido 1: 1 favorito");
    expect(describeChanges({ applied: { "catalog-import": 426 }, pushed: {} })).toBe("recibidos 426: 426 fichas del índice");
  });
});

describe("libros de este equipo por origen", () => {
  const doc = (id: string, kind: LibraryDocument["reference"]["kind"], copies?: Array<LibraryDocument["reference"]["kind"]>) =>
    ({
      copies: copies?.map((copyKind, index) => ({ availability: "available", id: `${id}-${index}`, kind: copyKind, location: "", origin: copyKind === "google-drive" ? "drive" : "local" })),
      id,
      reference: { kind },
    }) as unknown as LibraryDocument;

  it("cuenta cada copia en su origen aunque la biblioteca muestre el libro una vez", () => {
    // Dos libros en la carpeta y en Drive (agrupados por contenido), uno solo local y otro solo en Drive.
    const books = countBooks(
      [
        doc("a", "local-folder", ["local-folder", "google-drive"]),
        doc("b", "local-folder", ["local-folder", "google-drive"]),
        doc("c", "local-folder"),
        doc("d", "google-drive"),
      ],
      4,
    );
    expect(books.byOrigin).toEqual({ "google-drive": 3, "local-copy": 0, "local-file": 0, "local-folder": 3 });
    expect(books.inBoth).toBe(2);
    expect(books.distinct).toBe(4);
  });
});

describe("porcentaje al día", () => {
  it("tras una vuelta buena, todo; si falló, lo que quedó sin subir no cuenta", () => {
    const after = summary({ annotations: { local: 50 }, favorites: { local: 50 }, "catalog-ai": { disabled: true, local: 900 } });
    expect(syncedPercent(after, 0)).toBe(100);
    expect(syncedPercent(after, 25)).toBe(75);
    expect(syncedPercent(summary({}), 0)).toBe(100);
    expect(syncedPercent(null, 0)).toBeNull();
  });
});

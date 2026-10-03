import { describe, expect, it } from "vitest";

import { entry, type LocalSnapshot, type SyncCollection, type SyncContext } from "../cloud/sync/collections";
import { indexLibraryKeys } from "../cloud/sync/document-key";
import type { SyncEntry } from "../cloud/sync/sync-merge";
import { applyRestore, backupFileName, createBackup, parseBackup, planRestore } from "./backup";
import type { LibraryDocument } from "./documents";

function book(id: string, name: string, sizeBytes = 1000): LibraryDocument {
  return {
    author: "",
    availability: "available",
    format: "pdf",
    id,
    meta: "",
    origin: "local",
    originalName: name,
    reference: { kind: "local-file", referenceId: id },
    sizeBytes,
    tags: [],
    title: name.replace(/\.pdf$/, ""),
  } as LibraryDocument;
}

/** Un equipo con favoritos y avance en memoria, y sus propios identificadores. */
function device(documents: LibraryDocument[]) {
  const favorites = new Set<string>();
  const progress = new Map<string, number>();
  const favoriteCollection: SyncCollection = {
    async apply(entries, context) {
      for (const item of entries) {
        const document = context.keys.documentByKey.get(item.key);
        if (document) favorites.add(document.id);
      }
    },
    docKeyOf: (key) => key,
    name: "favorites",
    snapshot(context) {
      const items = new Map<string, SyncEntry>();
      for (const id of favorites) {
        const key = context.keys.keyById.get(id);
        if (key) items.set(key, entry(key, { favorite: true }, context.now, key));
      }
      return items;
    },
  };
  const progressCollection: SyncCollection = {
    async apply(entries, context) {
      for (const item of entries) {
        const document = context.keys.documentByKey.get(item.key);
        if (document) progress.set(document.id, (item.payload as { percent: number }).percent);
      }
    },
    docKeyOf: (key) => key,
    name: "reading-progress",
    resolve: (local, remote) =>
      (local.payload as { percent: number }).percent >= (remote.payload as { percent: number }).percent ? "local" : "remote",
    snapshot(context) {
      const items = new Map<string, SyncEntry>();
      for (const [id, percent] of progress) {
        const key = context.keys.keyById.get(id);
        if (key) items.set(key, entry(key, { percent }, "2026-10-01T00:00:00.000Z", key));
      }
      return items;
    },
  };
  const collections = [favoriteCollection, progressCollection];
  return {
    collections,
    async context(now = "2026-10-02T12:00:00.000Z"): Promise<SyncContext> {
      return { keys: await indexLibraryKeys(documents), local: {} as LocalSnapshot, now };
    },
    documents,
    favorites,
    progress,
  };
}

describe("copia de seguridad", () => {
  it("guarda lo que la persona hizo, con los libros legibles a mano", async () => {
    const pc = device([book("pc-1", "Morel.pdf"), book("pc-2", "Ficciones.pdf", 2000)]);
    pc.favorites.add("pc-1");
    pc.progress.set("pc-2", 40);
    const backup = createBackup(pc.collections, await pc.context());

    expect(backup.pliegueBackup).toBe(1);
    expect(backup.collections.favorites).toHaveLength(1);
    expect(backup.collections["reading-progress"]?.[0]?.payload).toEqual({ percent: 40 });
    expect(backup.books.map((item) => [item.title, item.file])).toEqual([
      ["Ficciones", "ficciones.pdf:2000"],
      ["Morel", "morel.pdf:1000"],
    ]);
    expect(backupFileName(backup.createdAt)).toBe("pliegue-copia-2026-10-02.json");
  });

  it("se restaura en otro equipo por el archivo, sin borrar nada de lo que ya había", async () => {
    const pc = device([book("pc-1", "Morel.pdf"), book("pc-2", "Ficciones.pdf", 2000), book("pc-3", "Rayuela.pdf", 3000)]);
    pc.favorites.add("pc-1");
    pc.favorites.add("pc-3");
    pc.progress.set("pc-2", 70);
    const file = JSON.parse(JSON.stringify(createBackup(pc.collections, await pc.context())));

    // El portátil tiene «Morel» y «Ficciones» con otros identificadores, pero no «Rayuela».
    const laptop = device([book("lap-a", "Morel.pdf"), book("lap-b", "Ficciones.pdf", 2000), book("lap-c", "Otro.pdf", 9)]);
    laptop.favorites.add("lap-c");
    laptop.progress.set("lap-b", 50);
    const context = await laptop.context();
    const plan = planRestore(parseBackup(file), laptop.collections, context);

    expect(plan.collections.favorites).toMatchObject({ apply: 1, incoming: 2, kept: 0, waiting: 1 });
    expect(plan.collections["reading-progress"]).toMatchObject({ apply: 1, incoming: 1, kept: 0, waiting: 0 });

    expect(await applyRestore(plan, laptop.collections, context)).toBe(2);
    expect([...laptop.favorites].sort()).toEqual(["lap-a", "lap-c"]);
    expect(laptop.progress.get("lap-b")).toBe(70);
  });

  it("con el avance gana el mayor: un avance más bajo de la copia no se aplica", async () => {
    const pc = device([book("pc-1", "Morel.pdf")]);
    pc.progress.set("pc-1", 30);
    const backup = createBackup(pc.collections, await pc.context());
    const laptop = device([book("lap-1", "Morel.pdf")]);
    laptop.progress.set("lap-1", 80);
    const plan = planRestore(backup, laptop.collections, await laptop.context());
    expect(plan.collections["reading-progress"]).toMatchObject({ apply: 0, kept: 1 });
  });

  it("rechaza un archivo que no es una copia, o de una versión más nueva", () => {
    expect(() => parseBackup({ entries: [] })).toThrow(/no es una copia de seguridad de Pliegue/);
    expect(() => parseBackup({ collections: {}, pliegueBackup: 2 })).toThrow(/versión de Pliegue más nueva/);
    expect(() => parseBackup({ pliegueBackup: 1 })).toThrow(/incompleta/);
    expect(parseBackup({ collections: { favorites: [{ key: "k", payload: {}, updatedAt: "t" }, { mal: true }] }, pliegueBackup: 1 }).collections.favorites).toHaveLength(1);
  });
});

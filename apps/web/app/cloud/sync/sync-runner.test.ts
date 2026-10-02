import { describe, expect, it } from "vitest";

import type { LibraryDocument } from "../../library/documents";
import type { LocalSnapshot, SyncCollection, SyncContext } from "./collections";
import { entry } from "./collections";
import { indexLibraryKeys } from "./document-key";
import {
  emptySyncState,
  runSync,
  type OutgoingRow,
  type RemoteRow,
  type RemoteStore,
  type SyncState,
} from "./sync-runner";

/** Una nube en memoria que se comporta como `sync_items`: la última escritura gana. */
function memoryCloud() {
  const rows = new Map<string, RemoteRow>();
  let clock = Date.parse("2026-09-30T12:00:00.000Z");
  return {
    rows,
    store(): RemoteStore {
      return {
        async pull(since) {
          return [...rows.values()]
            .filter((row) => !since || row.server_updated_at > since)
            .sort((left, right) => left.server_updated_at.localeCompare(right.server_updated_at));
        },
        async push(outgoing: readonly OutgoingRow[]) {
          for (const row of outgoing) {
            const id = `${row.collection}/${row.item_key}`;
            const current = rows.get(id);
            if (current && row.updated_at < current.updated_at) continue;
            clock += 1000;
            rows.set(id, { ...row, server_updated_at: new Date(clock).toISOString() });
          }
        },
      };
    },
  };
}

function memoryState() {
  let state: SyncState = emptySyncState;
  return {
    async load() {
      return state;
    },
    async save(next: SyncState) {
      state = next;
    },
  };
}

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
    title: name,
  } as LibraryDocument;
}

/** Un equipo con favoritos en memoria y sus propios identificadores de documento. */
function device(documents: LibraryDocument[]) {
  const favorites = new Set<string>();
  const collection: SyncCollection = {
    async apply(entries, context) {
      for (const item of entries) {
        const document = context.keys.documentByKey.get(item.key);
        if (!document) continue;
        if (item.deleted) favorites.delete(document.id);
        else favorites.add(document.id);
      }
    },
    docKeyOf: (key) => key,
    name: "favorites",
    snapshot(context) {
      const items = new Map();
      for (const id of favorites) {
        const key = context.keys.keyById.get(id);
        if (key) items.set(key, entry(key, { favorite: true }, context.now, key));
      }
      return items;
    },
  };
  const state = memoryState();

  return {
    /** Los documentos de este equipo: un test puede cambiarlos entre una vuelta y otra. */
    documents,
    favorites,
    async sync(cloud: ReturnType<typeof memoryCloud>, now: string, options: { allowMassDeletion?: boolean } = {}) {
      const context: SyncContext = {
        keys: await indexLibraryKeys(documents),
        local: { favorites: [...favorites] } as unknown as LocalSnapshot,
        now,
      };
      return runSync({ collections: [collection], context, enabled: () => true, remote: cloud.store(), stateStore: state, ...options });
    },
  };
}

describe("sincronización entre dos equipos", () => {
  it("un favorito viaja al otro equipo por el archivo, aunque allí tenga otro identificador", async () => {
    const cloud = memoryCloud();
    const pc = device([book("pc-1", "Morel.pdf"), book("pc-2", "Ficciones.pdf")]);
    const laptop = device([book("lap-9", "morel.pdf"), book("lap-8", "Otro.pdf")]);

    pc.favorites.add("pc-1");
    pc.favorites.add("pc-2");
    expect((await pc.sync(cloud, "2026-09-30T12:01:00.000Z")).pushed).toBe(2);

    await laptop.sync(cloud, "2026-09-30T12:02:00.000Z");
    // «Morel.pdf» está en los dos; «Ficciones.pdf» solo en el PC y no se inventa aquí.
    expect([...laptop.favorites]).toEqual(["lap-9"]);
  });

  it("quitar un favorito en un equipo lo quita en el otro, y un equipo sin el libro no lo borra", async () => {
    const cloud = memoryCloud();
    const pc = device([book("pc-1", "Morel.pdf")]);
    const laptop = device([book("lap-9", "Morel.pdf")]);
    const phone = device([]);

    pc.favorites.add("pc-1");
    await pc.sync(cloud, "2026-09-30T12:01:00.000Z");
    await laptop.sync(cloud, "2026-09-30T12:02:00.000Z");
    // El teléfono no tiene el libro: sincroniza y no debe subir ningún borrado.
    expect((await phone.sync(cloud, "2026-09-30T12:03:00.000Z")).pushed).toBe(0);

    laptop.favorites.delete("lap-9");
    await laptop.sync(cloud, "2026-09-30T12:04:00.000Z");
    await pc.sync(cloud, "2026-09-30T12:05:00.000Z");
    expect(pc.favorites.size).toBe(0);
    expect([...cloud.rows.values()][0]?.deleted).toBe(true);
  });

  it("sincronizar sin cambios no sube nada", async () => {
    const cloud = memoryCloud();
    const pc = device([book("pc-1", "Morel.pdf")]);
    pc.favorites.add("pc-1");
    await pc.sync(cloud, "2026-09-30T12:01:00.000Z");
    const again = await pc.sync(cloud, "2026-09-30T12:06:00.000Z");
    expect(again).toMatchObject({ applied: 0, pushed: 0 });
  });
});

describe("un libro que cambia de documento en este equipo (06.3b)", () => {
  it("moverlo de carpeta no borra su favorito en la nube: el documento nuevo lo recibe", async () => {
    const cloud = memoryCloud();
    const pc = device([book("pc-raíz-morel", "Morel.pdf")]);
    pc.favorites.add("pc-raíz-morel");
    await pc.sync(cloud, "2026-10-02T12:00:00.000Z");

    // «Buscar cambios» tras moverlo: el mismo archivo es ahora otro documento, y el favorito
    // sigue guardado con el identificador viejo.
    pc.documents.splice(0, 1, book("pc-literatura-morel", "Morel.pdf"));
    const summary = await pc.sync(cloud, "2026-10-02T12:01:00.000Z");

    expect(summary.pushed).toBe(0);
    expect([...cloud.rows.values()].every((row) => !row.deleted)).toBe(true);
    expect(pc.favorites.has("pc-literatura-morel")).toBe(true);
  });

  it("si el libro vuelve a moverse, se sigue reconociendo", async () => {
    const cloud = memoryCloud();
    const pc = device([book("a", "Morel.pdf")]);
    pc.favorites.add("a");
    await pc.sync(cloud, "2026-10-02T12:00:00.000Z");
    pc.documents.splice(0, 1, book("b", "Morel.pdf"));
    await pc.sync(cloud, "2026-10-02T12:01:00.000Z");
    pc.documents.splice(0, 1, book("c", "Morel.pdf"));
    await pc.sync(cloud, "2026-10-02T12:02:00.000Z");
    expect(pc.favorites.has("c")).toBe(true);
    expect([...cloud.rows.values()].every((row) => !row.deleted)).toBe(true);
  });

  it("quitar el favorito del libro movido, después, sí se sube como borrado", async () => {
    const cloud = memoryCloud();
    const pc = device([book("a", "Morel.pdf")]);
    pc.favorites.add("a");
    await pc.sync(cloud, "2026-10-02T12:00:00.000Z");
    pc.documents.splice(0, 1, book("b", "Morel.pdf"));
    await pc.sync(cloud, "2026-10-02T12:01:00.000Z");

    pc.favorites.delete("a");
    pc.favorites.delete("b");
    await pc.sync(cloud, "2026-10-02T12:02:00.000Z");
    expect([...cloud.rows.values()][0]?.deleted).toBe(true);
  });
});

describe("red de seguridad contra borrados masivos", () => {
  const many = (prefix: string) => Array.from({ length: 12 }, (_, index) => book(`${prefix}-${index}`, `Libro ${index}.pdf`));

  it("una vuelta que iba a borrar más de 10 elementos se detiene sin subir nada", async () => {
    const cloud = memoryCloud();
    const pc = device(many("pc"));
    for (const document of pc.documents) pc.favorites.add(document.id);
    await pc.sync(cloud, "2026-10-02T12:00:00.000Z");

    pc.favorites.clear();
    await expect(pc.sync(cloud, "2026-10-02T12:01:00.000Z")).rejects.toMatchObject({ deletions: 12, name: "MassDeletionError" });
    expect([...cloud.rows.values()].every((row) => !row.deleted)).toBe(true);
  });

  it("con permiso explícito, los borrados se suben", async () => {
    const cloud = memoryCloud();
    const pc = device(many("pc"));
    for (const document of pc.documents) pc.favorites.add(document.id);
    await pc.sync(cloud, "2026-10-02T12:00:00.000Z");

    pc.favorites.clear();
    const summary = await pc.sync(cloud, "2026-10-02T12:01:00.000Z", { allowMassDeletion: true });
    expect(summary.pushed).toBe(12);
    expect([...cloud.rows.values()].every((row) => row.deleted)).toBe(true);
  });
});

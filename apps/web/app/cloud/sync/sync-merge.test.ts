import { describe, expect, it } from "vitest";

import { hashPayload, stableStringify } from "./stable-hash";
import { deletedHash, mergeCollection, type MergeOptions, type SyncEntry } from "./sync-merge";

const now = "2026-09-30T12:00:00.000Z";

function item(key: string, payload: unknown, updatedAt = "2026-09-30T10:00:00.000Z", docKey: string | null = null): SyncEntry {
  return { deleted: false, docKey, hash: hashPayload(payload), key, payload, updatedAt };
}

function gone(key: string, updatedAt = "2026-09-30T11:00:00.000Z", docKey: string | null = null): SyncEntry {
  return { deleted: true, docKey, hash: deletedHash, key, payload: null, updatedAt };
}

function map(...entries: SyncEntry[]) {
  return new Map(entries.map((entry) => [entry.key, entry]));
}

const everywhere: MergeOptions = { hasDocument: () => true, now };

describe("fusión a tres vías", () => {
  it("la primera vez une lo de aquí y lo de la nube, sin borrar nada", () => {
    const result = mergeCollection(map(), map(item("a", 1)), map(item("b", 2)), everywhere);
    expect(result.push.map((entry) => entry.key)).toEqual(["a"]);
    expect(result.apply.map((entry) => entry.key)).toEqual(["b"]);
    expect([...result.base.keys()].sort()).toEqual(["a", "b"]);
    // La base no guarda cargas: solo huellas.
    expect([...result.base.values()].every((entry) => entry.payload === null)).toBe(true);
  });

  it("sube lo que cambió aquí y aplica lo que cambió fuera", () => {
    const base = map(item("a", 1), item("b", 1));
    const result = mergeCollection(base, map(item("a", 2), item("b", 1)), map(item("b", 3)), everywhere);
    expect(result.push.map((entry) => [entry.key, entry.payload])).toEqual([["a", 2]]);
    expect(result.apply.map((entry) => [entry.key, entry.payload])).toEqual([["b", 3]]);
  });

  it("lo que ya no está aquí se sube como borrado; lo borrado fuera se aplica", () => {
    const base = map(item("a", 1), item("b", 1));
    const result = mergeCollection(base, map(item("b", 1)), map(gone("b")), everywhere);
    // «a» ya no está aquí: se borró en este equipo.
    expect(result.push).toEqual([expect.objectContaining({ deleted: true, hash: deletedHash, key: "a" })]);
    // «b» se borró fuera y aquí seguía: se aplica el borrado.
    expect(result.apply).toEqual([expect.objectContaining({ deleted: true, key: "b" })]);
    // Un borrado remoto de algo que aquí no existe no hay que aplicarlo.
    expect(mergeCollection(map(), map(), map(gone("c")), everywhere).apply).toEqual([]);
  });

  it("no toma por borrado lo de un libro que aquí no está, y lo guarda para cuando llegue", () => {
    const options: MergeOptions = { hasDocument: (docKey) => docKey !== "libro-ausente", now };
    const nota = item("nota", { texto: "hola" }, undefined, "libro-ausente");
    // Tras sincronizar en otro equipo, la base la tiene y aquí no está: no es un borrado.
    const result = mergeCollection(map({ ...nota, payload: null }), map(), map(nota), options);
    expect(result.push).toEqual([]);
    expect(result.apply).toEqual([]);
    expect(result.pending.get("nota")?.payload).toEqual({ texto: "hola" });
  });

  it("si cambian los dos, gana la escritura más reciente, o lo que diga la colección", () => {
    const base = map(item("a", 1));
    const local = item("a", 2, "2026-09-30T11:30:00.000Z");
    const remote = item("a", 3, "2026-09-30T11:00:00.000Z");
    expect(mergeCollection(base, map(local), map(remote), everywhere).push[0]?.payload).toBe(2);

    const remoteWins = mergeCollection(base, map(local), map(remote), { ...everywhere, resolve: () => "remote" });
    expect(remoteWins.push).toEqual([]);
    expect(remoteWins.apply[0]?.payload).toBe(3);
  });

  it("lo que gana aquí sube con una hora posterior a la remota, aunque el reloj vaya atrasado", () => {
    const remote = item("a", 3, "2026-09-30T13:00:00.000Z");
    const result = mergeCollection(map(item("a", 1)), map(item("a", 2, "2026-09-30T09:00:00.000Z")), map(remote), {
      ...everywhere,
      resolve: () => "local",
    });
    expect((result.push[0]?.updatedAt ?? "") > remote.updatedAt).toBe(true);
  });

  it("lo que ya coincide no se sube ni se aplica", () => {
    const result = mergeCollection(map(), map(item("a", { x: 1, y: 2 })), map(item("a", { y: 2, x: 1 })), everywhere);
    expect(result.push).toEqual([]);
    expect(result.apply).toEqual([]);
    expect(stableStringify({ b: 1, a: [2, { d: 1, c: 0 }] })).toBe('{"a":[2,{"c":0,"d":1}],"b":1}');
  });
});

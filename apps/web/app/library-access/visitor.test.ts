import { describe, expect, it } from "vitest";

import { maxSavedEntries, parseSavedEntries, rememberEntry, visitorStorageKeys, type SavedEntry } from "./visitor";

const entry = (code: string, name: string, at = "2026-10-03T10:00:00.000Z"): SavedEntry => ({ at, code, name });

describe("entradas guardadas del visitante", () => {
  it("la última va primero, sin repetir la misma persona con el mismo código", () => {
    let entries: SavedEntry[] = [];
    entries = rememberEntry(entries, entry("OCT2026AREQUIPA", "Ana"));
    entries = rememberEntry(entries, entry("OCT2026CUSCO", "Ana"));
    entries = rememberEntry(entries, entry("OCT2026AREQUIPA", " ana ", "2026-10-04T10:00:00.000Z"));
    expect(entries.map((item) => `${item.code}/${item.name}`)).toEqual(["OCT2026AREQUIPA/ ana ", "OCT2026CUSCO/Ana"]);
  });

  it("guarda como mucho tres", () => {
    let entries: SavedEntry[] = [];
    for (const name of ["A", "B", "C", "D"]) entries = rememberEntry(entries, entry("OCT2026AREQUIPA", name));
    expect(entries).toHaveLength(maxSavedEntries);
    expect(entries.map((item) => item.name)).toEqual(["D", "C", "B"]);
  });

  it("cada biblioteca con su equipo y sus entradas; la general, con las claves de siempre", () => {
    expect(visitorStorageKeys()).toEqual({ device: "pliegue-general-equipo", entries: "pliegue-general-entradas" });
    expect(visitorStorageKeys("general")).toEqual(visitorStorageKeys());
    const ana = visitorStorageKeys("ana-lopez");
    const beto = visitorStorageKeys("beto");
    expect(ana).toEqual({ device: "pliegue-biblioteca-ana-lopez-equipo", entries: "pliegue-biblioteca-ana-lopez-entradas" });
    expect(new Set([ana.device, beto.device, visitorStorageKeys().device]).size).toBe(3);
  });

  it("lee lo guardado con cuidado: lo roto o ajeno no rompe la entrada", () => {
    expect(parseSavedEntries(null)).toEqual([]);
    expect(parseSavedEntries("{roto")).toEqual([]);
    expect(parseSavedEntries('{"code":"X"}')).toEqual([]);
    expect(parseSavedEntries(JSON.stringify([entry("OCT2026AREQUIPA", "Ana"), { code: 1 }, null]))).toEqual([entry("OCT2026AREQUIPA", "Ana")]);
  });
});

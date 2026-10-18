import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { isSharedLibrarySlug, reservedLibrarySlugs, sharedSlugFromParam } from "./library-slug";

describe("dirección de una biblioteca compartida", () => {
  it("acepta minúsculas, números y guiones sueltos; empieza por letra", () => {
    for (const slug of ["luis-lara", "ana", "club-de-lectura-2026", "b2"]) expect(isSharedLibrarySlug(slug)).toBe(true);
    for (const slug of ["", "a", "Luis-Lara", "luis lara", "luis--lara", "-luis", "luis-", "2026-club", "ñandú", "x".repeat(41)]) {
      expect(isSharedLibrarySlug(slug)).toBe(false);
    }
  });

  it("no puede tomar una dirección reservada, empezando por la general", () => {
    expect(reservedLibrarySlugs).toContain("general");
    for (const slug of reservedLibrarySlugs) expect(isSharedLibrarySlug(slug)).toBe(false);
  });

  it("lleva la dirección de la URL a su forma canónica, o a ninguna", () => {
    expect(sharedSlugFromParam("luis-lara")).toBe("luis-lara");
    expect(sharedSlugFromParam("Luis-Lara")).toBe("luis-lara");
    expect(sharedSlugFromParam("GENERAL")).toBeNull();
    expect(sharedSlugFromParam("luis%20lara")).toBeNull();
  });

  it("reserva lo mismo que la base", () => {
    const migration = readFileSync(new URL("../../../../supabase/migrations/20261018120000_bibliotecas_compartidas.sql", import.meta.url), "utf8");
    const reserved = /slug <> all \(array\[([^\]]+)\]\)/.exec(migration)?.[1] ?? "";
    expect(reserved.split(",").map((name) => name.trim().replaceAll("'", ""))).toEqual([...reservedLibrarySlugs]);
  });
});

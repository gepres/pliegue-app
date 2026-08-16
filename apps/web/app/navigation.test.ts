import { describe, expect, it } from "vitest";

import { isNavigationItemActive, isWideSection } from "./navigation";

describe("isNavigationItemActive", () => {
  it("only marks Inicio on the exact app route", () => {
    expect(isNavigationItemActive("/app", "/app")).toBe(true);
    expect(isNavigationItemActive("/app/biblioteca", "/app")).toBe(false);
  });

  it("keeps a section active for nested routes", () => {
    expect(
      isNavigationItemActive("/app/biblioteca/documento-1", "/app/biblioteca"),
    ).toBe(true);
  });
});

describe("isWideSection", () => {
  it("solo el Lector ocupa todo el ancho disponible", () => {
    expect(isWideSection("/app/lector")).toBe(true);
    expect(isWideSection("/app")).toBe(false);
    expect(isWideSection("/app/biblioteca")).toBe(false);
    expect(isWideSection("/app/ia")).toBe(false);
    expect(isWideSection("/app/ajustes")).toBe(false);
  });

  it("mantiene el ancho completo al abrir un documento concreto", () => {
    expect(isWideSection("/app/lector/documento-1")).toBe(true);
  });
});

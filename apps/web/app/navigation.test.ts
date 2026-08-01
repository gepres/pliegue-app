import { describe, expect, it } from "vitest";

import { isNavigationItemActive } from "./navigation";

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

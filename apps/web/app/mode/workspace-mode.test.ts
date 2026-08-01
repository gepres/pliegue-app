import { describe, expect, it } from "vitest";

import { defaultWorkspaceMode, parseWorkspaceMode } from "./workspace-mode";

describe("parseWorkspaceMode", () => {
  it("usa local-only cuando no existe configuración", () => {
    expect(parseWorkspaceMode(null)).toEqual(defaultWorkspaceMode);
  });

  it("restaura una confirmación local válida", () => {
    expect(
      parseWorkspaceMode({
        confirmedAt: "2026-08-01T10:00:00.000Z",
        mode: "local-only",
        version: 1,
      }),
    ).toEqual({
      confirmedAt: "2026-08-01T10:00:00.000Z",
      mode: "local-only",
      version: 1,
    });
  });

  it("no activa una cuenta que todavía no tiene backend", () => {
    expect(parseWorkspaceMode({ mode: "account", version: 1 })).toEqual(
      defaultWorkspaceMode,
    );
  });
});

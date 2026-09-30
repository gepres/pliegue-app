import { describe, expect, it } from "vitest";

import { defaultShellLayout, parseShellLayout } from "./shell-layout";

describe("estado del marco de la aplicación", () => {
  it("abre con la navegación desplegada", () => {
    expect(defaultShellLayout.navigationCollapsed).toBe(false);
  });

  it("conserva la navegación plegada entre sesiones", () => {
    expect(parseShellLayout({ navigationCollapsed: true, version: 1 })).toEqual({
      navigationCollapsed: true,
      version: 1,
    });
  });

  it("descarta lo que no reconoce en vez de dejar el marco a medias", () => {
    // Un almacenamiento manipulado o de una versión futura no debe poder esconder la
    // navegación sin que haya forma de recuperarla.
    for (const stored of [null, "plegado", [], { version: 2, navigationCollapsed: true }]) {
      expect(parseShellLayout(stored)).toEqual(defaultShellLayout);
    }
  });

  it("solo acepta el valor booleano exacto", () => {
    expect(parseShellLayout({ navigationCollapsed: "sí", version: 1 })).toEqual(
      defaultShellLayout,
    );
    expect(parseShellLayout({ navigationCollapsed: 1, version: 1 })).toEqual(
      defaultShellLayout,
    );
  });
});

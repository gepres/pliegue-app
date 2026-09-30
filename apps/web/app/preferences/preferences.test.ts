import { describe, expect, it } from "vitest";

import {
  applyReadingProfile,
  effectiveScopeFor,
  emptyPreferenceState,
  parsePreferenceState,
  resolvePreferences,
  stepReaderScale,
  updateScopedPreference,
} from "./preferences";

describe("preferencias", () => {
  it("resuelve documento sobre Área, cuenta y dispositivo", () => {
    const device = updateScopedPreference(emptyPreferenceState, "device", "readerScale", 90);
    const account = updateScopedPreference(device, "account", "readerScale", 100);
    const workspace = updateScopedPreference(account, "workspace", "readerScale", 115);
    const document = updateScopedPreference(workspace, "document", "readerScale", 130);

    expect(resolvePreferences(document).readerScale).toBe(130);
  });

  it("elimina valores inválidos al restaurar datos", () => {
    expect(
      parsePreferenceState({
        version: 1,
        scopes: { device: { readerScale: 999, theme: "neon" } },
      }).scopes.device,
    ).toEqual({});
  });

  it("aplica un perfil como conjunto coherente", () => {
    const state = applyReadingProfile(emptyPreferenceState, "workspace", "accessible");
    expect(state.scopes.workspace).toMatchObject({
      lineHeight: "relaxed",
      profile: "accessible",
      readerFont: "sans",
      readerScale: 130,
    });
  });
});

describe("cambios desde el lector", () => {
  it("guarda en el dispositivo cuando ningún nivel define la clave", () => {
    expect(effectiveScopeFor(emptyPreferenceState, "readerScale")).toBe("device");
  });

  it("guarda en el nivel más fuerte que ya la define, para que el cambio se vea", () => {
    const device = updateScopedPreference(emptyPreferenceState, "device", "readerFont", "sans");
    const workspace = updateScopedPreference(device, "workspace", "readerFont", "serif");
    expect(effectiveScopeFor(workspace, "readerFont")).toBe("workspace");
    expect(effectiveScopeFor(workspace, "lineHeight")).toBe("device");
  });

  it("recorre la escala de lectura sin salirse de los extremos", () => {
    expect(stepReaderScale(100, 1)).toBe(115);
    expect(stepReaderScale(100, -1)).toBe(90);
    expect(stepReaderScale(90, -1)).toBe(90);
    expect(stepReaderScale(130, 1)).toBe(130);
  });
});

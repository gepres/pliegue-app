import { describe, expect, it } from "vitest";

import {
  applyReadingProfile,
  emptyPreferenceState,
  parsePreferenceState,
  resolvePreferences,
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

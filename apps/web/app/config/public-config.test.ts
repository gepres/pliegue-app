import { describe, expect, it } from "vitest";

import { readPublicConfig } from "./public-config";

describe("readPublicConfig", () => {
  it("aplica valores seguros cuando no hay entorno configurado", () => {
    expect(readPublicConfig({})).toEqual({
      cloud: null,
      drive: null,
      environment: "development",
      features: {
        aiPanel: true,
        drive: true,
        localFiles: true,
      },
    });
  });

  it("solo habilita flags con valores booleanos explícitos", () => {
    expect(
      readPublicConfig({
        NEXT_PUBLIC_FEATURE_AI_PANEL: "false",
        NEXT_PUBLIC_FEATURE_DRIVE: "true",
        NEXT_PUBLIC_FEATURE_LOCAL_FILES: "invalid",
        NEXT_PUBLIC_PLIEGUE_APP_ENV: "staging",
      }),
    ).toEqual({
      cloud: null,
      drive: null,
      environment: "staging",
      features: {
        aiPanel: false,
        drive: true,
        localFiles: true,
      },
    });
  });

  it("activa la nube solo con URL HTTPS y clave publicable", () => {
    expect(
      readPublicConfig({
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: " sb_publishable_x ",
        NEXT_PUBLIC_SUPABASE_URL: "https://proyecto.supabase.co/",
      }).cloud,
    ).toEqual({ publishableKey: "sb_publishable_x", url: "https://proyecto.supabase.co" });
    expect(readPublicConfig({ NEXT_PUBLIC_SUPABASE_URL: "https://proyecto.supabase.co" }).cloud).toBeNull();
    expect(
      readPublicConfig({
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
        NEXT_PUBLIC_SUPABASE_URL: "http://proyecto.supabase.co",
      }).cloud,
    ).toBeNull();
    expect(
      readPublicConfig({
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "clave-antigua",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      }).cloud,
    ).toEqual({ publishableKey: "clave-antigua", url: "http://127.0.0.1:54321" });
  });

  it("activa Drive solo con las tres credenciales públicas bien formadas", () => {
    const google = {
      NEXT_PUBLIC_GOOGLE_API_KEY: " AIzaClave ",
      NEXT_PUBLIC_GOOGLE_CLIENT_ID: "123-abc.apps.googleusercontent.com",
      NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER: "123456789",
    };
    expect(readPublicConfig(google).drive).toEqual({
      apiKey: "AIzaClave",
      appId: "123456789",
      clientId: "123-abc.apps.googleusercontent.com",
    });
    expect(readPublicConfig({ ...google, NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER: "pliegue-app" }).drive).toBeNull();
    expect(readPublicConfig({ ...google, NEXT_PUBLIC_GOOGLE_CLIENT_ID: "AIzaClave" }).drive).toBeNull();
    expect(readPublicConfig({ ...google, NEXT_PUBLIC_FEATURE_DRIVE: "false" }).drive).toBeNull();
  });
});

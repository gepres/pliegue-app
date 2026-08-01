import { describe, expect, it } from "vitest";

import { readPublicConfig } from "./public-config";

describe("readPublicConfig", () => {
  it("aplica valores seguros cuando no hay entorno configurado", () => {
    expect(readPublicConfig({})).toEqual({
      environment: "development",
      features: {
        aiPanel: true,
        drive: false,
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
      environment: "staging",
      features: {
        aiPanel: false,
        drive: true,
        localFiles: true,
      },
    });
  });
});

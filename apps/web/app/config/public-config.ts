export const appEnvironments = ["development", "staging", "production", "test"] as const;

export type AppEnvironment = (typeof appEnvironments)[number];

export interface PublicConfig {
  environment: AppEnvironment;
  features: {
    aiPanel: boolean;
    drive: boolean;
    localFiles: boolean;
  };
}

type PublicEnvironment = Record<string, string | undefined>;

function readBoolean(value: string | undefined, fallback: boolean) {
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function readEnvironment(value: string | undefined): AppEnvironment {
  return appEnvironments.includes(value as AppEnvironment)
    ? (value as AppEnvironment)
    : "development";
}

export function readPublicConfig(environment: PublicEnvironment): PublicConfig {
  return {
    environment: readEnvironment(environment.NEXT_PUBLIC_PLIEGUE_APP_ENV),
    features: {
      aiPanel: readBoolean(environment.NEXT_PUBLIC_FEATURE_AI_PANEL, true),
      drive: readBoolean(environment.NEXT_PUBLIC_FEATURE_DRIVE, false),
      localFiles: readBoolean(environment.NEXT_PUBLIC_FEATURE_LOCAL_FILES, true),
    },
  };
}

export const publicConfig = readPublicConfig({
  NEXT_PUBLIC_FEATURE_AI_PANEL: process.env.NEXT_PUBLIC_FEATURE_AI_PANEL,
  NEXT_PUBLIC_FEATURE_DRIVE: process.env.NEXT_PUBLIC_FEATURE_DRIVE,
  NEXT_PUBLIC_FEATURE_LOCAL_FILES: process.env.NEXT_PUBLIC_FEATURE_LOCAL_FILES,
  NEXT_PUBLIC_PLIEGUE_APP_ENV: process.env.NEXT_PUBLIC_PLIEGUE_APP_ENV,
});

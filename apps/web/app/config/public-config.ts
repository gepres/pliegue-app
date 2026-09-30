export const appEnvironments = ["development", "staging", "production", "test"] as const;

export type AppEnvironment = (typeof appEnvironments)[number];

/**
 * El proyecto de Supabase. La clave publicable es pública por diseño —la ve cualquiera que abra
 * la app— y lo que protege los datos son las políticas RLS de la base. Sin las dos variables la
 * nube no existe y Pliegue funciona solo en local, que es su modo por defecto.
 */
export interface CloudConfig {
  publishableKey: string;
  url: string;
}

export interface PublicConfig {
  cloud: CloudConfig | null;
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

function readCloud(url: string | undefined, key: string | undefined): CloudConfig | null {
  const publishableKey = key?.trim();
  if (!url?.trim() || !publishableKey) return null;
  try {
    const parsed = new URL(url.trim());
    // Solo HTTPS, salvo un Supabase local de desarrollo.
    const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    if (parsed.protocol !== "https:" && !local) return null;
    return { publishableKey, url: parsed.origin };
  } catch {
    return null;
  }
}

export function readPublicConfig(environment: PublicEnvironment): PublicConfig {
  return {
    cloud: readCloud(
      environment.NEXT_PUBLIC_SUPABASE_URL,
      environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? environment.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    ),
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
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
});

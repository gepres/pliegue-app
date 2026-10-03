import { normalizeAccessCode, signSession, verifySession, sessionExpiry, sessionVersion, type LibrarySession } from "./access-session";

/**
 * Lo que el servidor de Pliegue hace por la biblioteca general: canjear un código en Supabase y
 * comprobar después que sigue valiendo. Solo aquí se usa la clave secreta de Supabase; nunca
 * llega al navegador.
 *
 * Variables (de servidor, sin `NEXT_PUBLIC_`):
 * - `SUPABASE_SECRET_KEY` (o la antigua `SUPABASE_SERVICE_ROLE_KEY`).
 * - `PLIEGUE_GENERAL_FOLDER_ID`: la carpeta de Drive de la biblioteca general.
 * - `PLIEGUE_LIBRARY_SECRET`: opcional; firma las sesiones. Si falta, se usa la clave secreta.
 * - `SUPABASE_URL`: opcional; por defecto, la pública.
 */
export const generalLibrary = "general";

export interface LibraryServerConfig {
  folderId: string;
  secretKey: string;
  sessionSecret: string;
  supabaseUrl: string;
}

type Environment = Record<string, string | undefined>;

export function readLibraryServerConfig(environment: Environment = process.env): LibraryServerConfig | null {
  const supabaseUrl = (environment.SUPABASE_URL ?? environment.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  const secretKey = (environment.SUPABASE_SECRET_KEY ?? environment.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  const folderId = (environment.PLIEGUE_GENERAL_FOLDER_ID ?? "").trim();
  if (!supabaseUrl || !secretKey || !folderId) return null;
  return { folderId, secretKey, sessionSecret: environment.PLIEGUE_LIBRARY_SECRET?.trim() || secretKey, supabaseUrl };
}

export interface LibraryServerDeps {
  config: LibraryServerConfig | null;
  fetcher?: typeof fetch;
  now?: () => number;
}

/** Las claves nuevas de Supabase (`sb_secret_…`) van solo en `apikey`; la `service_role` antigua es un JWT y va también como portador. */
function supabaseHeaders(secretKey: string): Record<string, string> {
  return {
    apikey: secretKey,
    ...(secretKey.startsWith("eyJ") ? { Authorization: `Bearer ${secretKey}` } : {}),
    "Content-Type": "application/json",
  };
}

export type RedeemFailure = "expired" | "exhausted" | "invalid" | "too-many" | "unavailable";

export type RedeemOutcome =
  | { cookie: { maxAgeSeconds: number; value: string }; ok: true; session: LibrarySession }
  | { ok: false; reason: RedeemFailure };

export const redeemMessages: Record<RedeemFailure, string> = {
  expired: "Este código ya caducó. Pide uno nuevo a quien te lo dio.",
  exhausted: "Este código ya se usó todas las veces permitidas.",
  invalid: "Ese código no existe o ya no está activo. Revísalo y vuelve a intentarlo.",
  "too-many": "Demasiados intentos fallidos. Espera unos minutos antes de volver a probar.",
  unavailable: "La biblioteca general no está disponible ahora mismo. Inténtalo más tarde.",
};

/** Una huella de la conexión para frenar intentos a ciegas, sin guardar la IP. */
export async function clientFingerprint(ip: string, secret: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${secret}|${ip || "desconocida"}`));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

interface RedeemRow {
  code_id: string | null;
  expires_at: string | null;
  ok: boolean;
  reason: string;
}

/** Canjea un código: lo valida en Supabase, registra la entrada y prepara la cookie de sesión. */
export async function redeemAccessCode(
  input: { code: string; deviceId: string; ip: string; name: string; userAgent: string },
  deps: LibraryServerDeps,
): Promise<RedeemOutcome> {
  const { config } = deps;
  if (!config) return { ok: false, reason: "unavailable" };
  const code = normalizeAccessCode(input.code);
  if (!code) return { ok: false, reason: "invalid" };

  let row: RedeemRow | undefined;
  try {
    const response = await (deps.fetcher ?? fetch)(`${config.supabaseUrl}/rest/v1/rpc/redeem_library_code`, {
      body: JSON.stringify({
        p_client_hash: await clientFingerprint(input.ip, config.sessionSecret),
        p_code: code,
        p_device_id: input.deviceId,
        p_library: generalLibrary,
        p_user_agent: input.userAgent.slice(0, 300),
        p_visitor_name: input.name,
      }),
      cache: "no-store",
      headers: supabaseHeaders(config.secretKey),
      method: "POST",
    });
    if (!response.ok) return { ok: false, reason: "unavailable" };
    row = ((await response.json()) as RedeemRow[])[0];
  } catch {
    return { ok: false, reason: "unavailable" };
  }

  if (!row?.ok || !row.code_id) {
    const reason = row?.reason;
    return { ok: false, reason: reason === "expired" || reason === "exhausted" || reason === "too-many" ? reason : "invalid" };
  }
  const now = deps.now?.() ?? Date.now();
  const session: LibrarySession = {
    codeId: row.code_id,
    device: input.deviceId,
    exp: sessionExpiry(now, row.expires_at),
    iat: now,
    library: generalLibrary,
    name: input.name,
    v: sessionVersion,
  };
  return {
    cookie: { maxAgeSeconds: Math.max(1, Math.floor((session.exp - now) / 1000)), value: await signSession(session, config.sessionSecret) },
    ok: true,
    session,
  };
}

/** ¿El código de una sesión sigue activo y sin caducar? Así, desactivarlo corta el acceso al momento. */
export async function accessCodeStillValid(codeId: string, deps: LibraryServerDeps) {
  const { config } = deps;
  if (!config) return false;
  try {
    const query = new URLSearchParams({ id: `eq.${codeId}`, select: "active,expires_at" });
    const response = await (deps.fetcher ?? fetch)(`${config.supabaseUrl}/rest/v1/library_access_codes?${query}`, {
      cache: "no-store",
      headers: supabaseHeaders(config.secretKey),
    });
    if (!response.ok) return false;
    const [code] = (await response.json()) as Array<{ active: boolean; expires_at: string | null }>;
    if (!code?.active) return false;
    return !code.expires_at || Date.parse(code.expires_at) > (deps.now?.() ?? Date.now());
  } catch {
    return false;
  }
}

export interface GeneralLibraryAccess {
  folderId: string;
  session: LibrarySession;
}

/** El identificador de un código, para saber si un enlace trae el mismo con el que ya se entró. */
export async function accessCodeId(code: string, deps: LibraryServerDeps) {
  const { config } = deps;
  const normalized = normalizeAccessCode(code);
  if (!config || !normalized) return null;
  try {
    const query = new URLSearchParams({ code: `eq.${normalized}`, library: `eq.${generalLibrary}`, select: "id" });
    const response = await (deps.fetcher ?? fetch)(`${config.supabaseUrl}/rest/v1/library_access_codes?${query}`, {
      cache: "no-store",
      headers: supabaseHeaders(config.secretKey),
    });
    if (!response.ok) return null;
    const [row] = (await response.json()) as Array<{ id: string }>;
    return row?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * ¿Sigue en el registro la entrada de esta persona? Si el administrador la quitó, su sesión deja
 * de valer en la próxima visita. Se compara el nombre sin distinguir mayúsculas, como las vueltas.
 */
export async function visitorStillRegistered(session: Pick<LibrarySession, "codeId" | "device" | "name">, deps: LibraryServerDeps) {
  const { config } = deps;
  if (!config) return false;
  try {
    const query = new URLSearchParams({ code_id: `eq.${session.codeId}`, device_id: `eq.${session.device}`, select: "visitor_name" });
    const response = await (deps.fetcher ?? fetch)(`${config.supabaseUrl}/rest/v1/library_access_events?${query}`, {
      cache: "no-store",
      headers: supabaseHeaders(config.secretKey),
    });
    if (!response.ok) return false;
    const name = session.name.toLocaleLowerCase("es");
    const events = (await response.json()) as Array<{ visitor_name: string }>;
    return events.some((event) => event.visitor_name.toLocaleLowerCase("es") === name);
  } catch {
    return false;
  }
}

/**
 * La sesión de la cookie, con la carpeta que abre, si la firma es buena, su código sigue valiendo
 * y la persona sigue en el registro.
 */
export async function readGeneralLibraryAccess(cookieValue: string | undefined, deps: LibraryServerDeps): Promise<GeneralLibraryAccess | null> {
  const { config } = deps;
  if (!config) return null;
  const session = await verifySession(cookieValue, config.sessionSecret, deps.now?.() ?? Date.now());
  if (!session || session.library !== generalLibrary) return null;
  const [codeValid, registered] = await Promise.all([accessCodeStillValid(session.codeId, deps), visitorStillRegistered(session, deps)]);
  if (!codeValid || !registered) return null;
  return { folderId: config.folderId, session };
}

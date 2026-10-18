import type { LibraryBaseConfig } from "./access-server";

/**
 * Crear una biblioteca compartida, en el servidor de Pliegue. El navegador manda la sesión de la
 * cuenta y el token de Drive con el que eligió la carpeta; aquí se comprueba quién es, que la
 * carpeta es suya y que es pública, y se crea con la clave secreta (el navegador no puede).
 *
 * Variables, además de las de `access-server`:
 * - `PLIEGUE_DRIVE_API_URL`: opcional; por defecto, la de Google. Para pruebas.
 */

export interface SharedLibraryServerDeps {
  config: LibraryBaseConfig | null;
  driveApiUrl?: string;
  fetcher?: typeof fetch;
}

const defaultDriveApiUrl = "https://www.googleapis.com/drive/v3";
const folderMimeType = "application/vnd.google-apps.folder";

export function readDriveApiUrl(environment: Record<string, string | undefined> = process.env) {
  return (environment.PLIEGUE_DRIVE_API_URL ?? "").trim().replace(/\/+$/, "") || defaultDriveApiUrl;
}

/** La cuenta de Pliegue de un token de sesión, preguntada a Supabase Auth. `null` si no vale. */
export async function sessionUser(accessToken: string, deps: SharedLibraryServerDeps) {
  const { config } = deps;
  if (!config || !accessToken) return null;
  try {
    const response = await (deps.fetcher ?? fetch)(`${config.supabaseUrl}/auth/v1/user`, {
      cache: "no-store",
      headers: { apikey: config.secretKey, Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    const user = (await response.json()) as { email?: string; id?: string };
    return typeof user.id === "string" ? { email: user.email ?? null, id: user.id } : null;
  } catch {
    return null;
  }
}

export type FolderProblem = "drive" | "not-folder" | "not-public" | "not-yours";

export const folderProblemMessages: Record<FolderProblem, string> = {
  drive: "Drive no deja ver esa carpeta con tu conexión. Vuelve a conectar Drive y elige la carpeta otra vez.",
  "not-folder": "Eso no es una carpeta de Drive, o está en la papelera. Elige una carpeta.",
  "not-public":
    "La carpeta todavía no es pública. En Drive: Compartir → Acceso general → «Cualquier persona con el enlace», como lector. Luego vuelve a intentarlo.",
  "not-yours": "Esa carpeta no es tuya. Elige una que hayas creado tú o que puedas compartir.",
};

interface DriveFolderMeta {
  capabilities?: { canShare?: boolean };
  mimeType?: string;
  name?: string;
  ownedByMe?: boolean;
  permissions?: Array<{ role?: string; type?: string }>;
  trashed?: boolean;
}

/**
 * ¿Es una carpeta de esa persona (o puede compartirla) y la ve cualquiera con el enlace? Se
 * pregunta a Drive con el token de quien la eligió: con `drive.file` alcanza para la carpeta que
 * eligió en el Picker y para leer con quién está compartida.
 */
export async function inspectDriveFolder(
  folderId: string,
  driveToken: string,
  deps: Pick<SharedLibraryServerDeps, "driveApiUrl" | "fetcher">,
): Promise<{ name: string; ok: true } | { ok: false; problem: FolderProblem }> {
  const query = new URLSearchParams({
    fields: "id,name,mimeType,trashed,ownedByMe,capabilities(canShare),permissions(type,role)",
    supportsAllDrives: "true",
  });
  let folder: DriveFolderMeta;
  try {
    const response = await (deps.fetcher ?? fetch)(`${deps.driveApiUrl ?? defaultDriveApiUrl}/files/${encodeURIComponent(folderId)}?${query}`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${driveToken}` },
    });
    if (!response.ok) return { ok: false, problem: "drive" };
    folder = (await response.json()) as DriveFolderMeta;
  } catch {
    return { ok: false, problem: "drive" };
  }
  if (folder.mimeType !== folderMimeType || folder.trashed) return { ok: false, problem: "not-folder" };
  if (!folder.ownedByMe && !folder.capabilities?.canShare) return { ok: false, problem: "not-yours" };
  const isPublic = (folder.permissions ?? []).some((permission) => permission.type === "anyone" && permission.role !== undefined);
  if (!isPublic) return { ok: false, problem: "not-public" };
  return { name: folder.name ?? "", ok: true };
}

export type ReportOutcome = "invalid" | "ok" | "too-many" | "unavailable";

/**
 * Registra la denuncia de un visitante, con lo que dice su sesión (código, nombre y equipo) y la
 * huella de su conexión. La base frena las repetidas y avisa a cada administrador.
 */
export async function submitLibraryReport(
  report: {
    clientHash: string;
    codeId: string;
    details: string;
    deviceId: string;
    fileId: string | null;
    library: string;
    reason: string;
    visitorName: string;
  },
  deps: SharedLibraryServerDeps,
): Promise<ReportOutcome> {
  const { config } = deps;
  if (!config) return "unavailable";
  try {
    const response = await (deps.fetcher ?? fetch)(`${config.supabaseUrl}/rest/v1/rpc/submit_library_report`, {
      body: JSON.stringify({
        p_client_hash: report.clientHash,
        p_code_id: report.codeId,
        p_details: report.details,
        p_device_id: report.deviceId,
        p_file_id: report.fileId,
        p_library: report.library,
        p_reason: report.reason,
        p_visitor_name: report.visitorName,
      }),
      cache: "no-store",
      headers: {
        apikey: config.secretKey,
        ...(config.secretKey.startsWith("eyJ") ? { Authorization: `Bearer ${config.secretKey}` } : {}),
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    if (!response.ok) return "unavailable";
    const [row] = (await response.json()) as Array<{ ok: boolean; reason: string }>;
    if (row?.ok) return "ok";
    return row?.reason === "too-many" ? "too-many" : "invalid";
  } catch {
    return "unavailable";
  }
}

export type CreateProblem = "already-has" | "slug-taken" | "unavailable";

export const createProblemMessages: Record<CreateProblem, string> = {
  "already-has": "Tu cuenta ya tiene una biblioteca compartida.",
  "slug-taken": "Esa dirección ya la usa otra biblioteca. Elige otra.",
  unavailable: "No fue posible crear la biblioteca ahora mismo. Inténtalo más tarde.",
};

/** Crea la biblioteca con la clave secreta. La base decide si la dirección o la cuenta ya tienen una. */
export async function insertSharedLibrary(
  library: { folderId: string; name: string; ownerId: string; slug: string; termsVersion: string },
  deps: SharedLibraryServerDeps,
  now = new Date(),
): Promise<{ ok: true } | { ok: false; problem: CreateProblem }> {
  const { config } = deps;
  if (!config) return { ok: false, problem: "unavailable" };
  try {
    const response = await (deps.fetcher ?? fetch)(`${config.supabaseUrl}/rest/v1/shared_libraries`, {
      body: JSON.stringify({
        folder_id: library.folderId,
        name: library.name,
        owner_id: library.ownerId,
        slug: library.slug,
        terms_accepted_at: now.toISOString(),
        terms_version: library.termsVersion,
        verified_at: now.toISOString(),
      }),
      cache: "no-store",
      headers: {
        apikey: config.secretKey,
        ...(config.secretKey.startsWith("eyJ") ? { Authorization: `Bearer ${config.secretKey}` } : {}),
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      method: "POST",
    });
    if (response.ok) return { ok: true };
    const error = (await response.json().catch(() => ({}))) as { code?: string; details?: string; message?: string };
    if (error.code === "23505") {
      return { ok: false, problem: /owner_id/.test(`${error.details ?? ""} ${error.message ?? ""}`) ? "already-has" : "slug-taken" };
    }
    return { ok: false, problem: "unavailable" };
  } catch {
    return { ok: false, problem: "unavailable" };
  }
}

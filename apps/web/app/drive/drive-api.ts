import { maxLinkedFolderFiles } from "../library/local-folder";
import {
  driveApiBase,
  driveContentUrl,
  driveFileFields,
  isDriveFolder,
  type DriveFileMeta,
  type DriveListedFile,
} from "./drive-files";

/**
 * Por qué falló una llamada a Drive, en lo que la interfaz necesita distinguir:
 * - `auth`: el token caducó o se revocó; hay que volver a conectar.
 * - `scope`: el token no alcanza (p. ej. una carpeta completa con solo `drive.file`).
 * - `not-found`: el archivo ya no existe o esta cuenta dejó de tener acceso.
 * - `rate`/`network`/`server`: pasajeros; se reintenta.
 */
export type DriveErrorKind = "auth" | "network" | "not-found" | "rate" | "scope" | "server" | "unknown";

export class DriveApiError extends Error {
  readonly kind: DriveErrorKind;
  readonly status: number;

  constructor(kind: DriveErrorKind, status: number, message: string) {
    super(message);
    this.kind = kind;
    this.name = "DriveApiError";
    this.status = status;
  }
}

const messages: Record<DriveErrorKind, string> = {
  auth: "El acceso a Google Drive caducó. Vuelve a conectar Drive.",
  network: "No hay conexión con Google Drive.",
  "not-found": "El archivo ya no está en Drive o esta cuenta dejó de tener acceso.",
  rate: "Google Drive pide ir más despacio. Se reintentará en unos segundos.",
  scope: "Falta permiso para leer esto en Drive: vuelve a elegir el archivo o a vincular su carpeta y acepta el acceso de solo lectura.",
  server: "Google Drive no respondió. Inténtalo de nuevo en un momento.",
  unknown: "Google Drive devolvió un error inesperado.",
};

interface DriveErrorBody {
  error?: { errors?: Array<{ reason?: string }>; message?: string; status?: string };
}

/** Traduce la respuesta de error de Drive a los casos que la app sabe tratar. */
export async function driveErrorFrom(response: Response): Promise<DriveApiError> {
  let reason = "";
  try {
    const body = (await response.json()) as DriveErrorBody;
    reason = body.error?.errors?.[0]?.reason ?? body.error?.status ?? "";
  } catch {
    // Sin cuerpo JSON: basta con el código.
  }
  const kind: DriveErrorKind =
    response.status === 401
      ? "auth"
      : response.status === 404
        ? "not-found"
        : response.status === 429 || /rateLimit|userRateLimit/i.test(reason)
          ? "rate"
          : response.status === 403
            ? /insufficient|appNotAuthorized|PERMISSION_DENIED|forbidden/i.test(reason) || !reason
              ? "scope"
              : "unknown"
            : response.status >= 500
              ? "server"
              : "unknown";
  return new DriveApiError(kind, response.status, messages[kind]);
}

export interface DriveRequestOptions {
  fetcher?: typeof fetch;
  /** Esperas entre reintentos; las pruebas las ponen a cero. */
  retryDelaysMs?: readonly number[];
  signal?: AbortSignal;
}

const defaultRetryDelays = [800, 2_500, 6_000];

function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (!ms) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

/** Una petición autenticada con reintentos para lo pasajero (cuota, 5xx, red). */
export async function driveRequest(url: string, token: string, options: DriveRequestOptions = {}) {
  const fetcher = options.fetcher ?? fetch;
  const delays = options.retryDelaysMs ?? defaultRetryDelays;

  for (let attempt = 0; ; attempt += 1) {
    let response: Response;
    try {
      response = await fetcher(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: options.signal ?? null,
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      if (attempt < delays.length) {
        await wait(delays[attempt] ?? 0, options.signal);
        continue;
      }
      throw new DriveApiError("network", 0, messages.network);
    }
    if (response.ok) return response;

    const error = await driveErrorFrom(response);
    if ((error.kind === "rate" || error.kind === "server") && attempt < delays.length) {
      await wait(delays[attempt] ?? 0, options.signal);
      continue;
    }
    throw error;
  }
}

async function driveJson<Result>(url: string, token: string, options?: DriveRequestOptions) {
  return (await (await driveRequest(url, token, options)).json()) as Result;
}

export function getDriveFile(fileId: string, token: string, options?: DriveRequestOptions) {
  const query = new URLSearchParams({ fields: driveFileFields, supportsAllDrives: "true" });
  return driveJson<DriveFileMeta>(`${driveApiBase}/files/${encodeURIComponent(fileId)}?${query}`, token, options);
}

/** El nombre y el correo de la cuenta: basta con `drive.file` para pedirlos. */
export async function getDriveUser(token: string, options?: DriveRequestOptions) {
  const about = await driveJson<{ user?: { displayName?: string; emailAddress?: string } }>(
    `${driveApiBase}/about?fields=user(displayName,emailAddress)`,
    token,
    options,
  );
  return { email: about.user?.emailAddress ?? null, name: about.user?.displayName ?? null };
}

/** Los hijos directos de una carpeta, página a página. En Shared Drives también. */
export async function listDriveChildren(folderId: string, token: string, options?: DriveRequestOptions) {
  const children: DriveFileMeta[] = [];
  let pageToken: string | undefined;

  do {
    const query = new URLSearchParams({
      fields: `nextPageToken,files(${driveFileFields})`,
      includeItemsFromAllDrives: "true",
      pageSize: "1000",
      q: `'${folderId.replaceAll("'", "\\'")}' in parents and trashed = false`,
      supportsAllDrives: "true",
    });
    if (pageToken) query.set("pageToken", pageToken);
    const page = await driveJson<{ files?: DriveFileMeta[]; nextPageToken?: string }>(
      `${driveApiBase}/files?${query}`,
      token,
      options,
    );
    children.push(...(page.files ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);

  return children;
}

export interface DriveFolderWalk {
  files: DriveListedFile[];
  folders: number;
}

/**
 * Recorre una carpeta y sus subcarpetas. Las rutas quedan relativas a la raíz, como en las
 * carpetas locales, para que un índice JSON de la misma biblioteca encaje por ruta. Se visita
 * cada carpeta una sola vez: en Drive un archivo puede estar en varias.
 */
export async function walkDriveFolder(
  folderId: string,
  token: string,
  options: DriveRequestOptions & { concurrency?: number; limit?: number; onFolder?: (visited: number) => void } = {},
): Promise<DriveFolderWalk> {
  const limit = options.limit ?? maxLinkedFolderFiles;
  const files: DriveListedFile[] = [];
  const seen = new Set<string>([folderId]);
  const queue: Array<{ id: string; prefix: string }> = [{ id: folderId, prefix: "" }];
  let folders = 0;
  let active = 0;

  await new Promise<void>((resolve, reject) => {
    let failed = false;

    function next() {
      if (failed) return;
      if (!queue.length && !active) return resolve();

      while (queue.length && active < (options.concurrency ?? 4)) {
        const folder = queue.shift();
        if (!folder) break;
        active += 1;
        listDriveChildren(folder.id, token, options)
          .then((children) => {
            folders += 1;
            options.onFolder?.(folders);
            for (const child of children) {
              const relativePath = folder.prefix ? `${folder.prefix}/${child.name}` : child.name;
              if (isDriveFolder(child)) {
                if (seen.has(child.id)) continue;
                seen.add(child.id);
                queue.push({ id: child.id, prefix: relativePath });
              } else {
                files.push({ ...child, relativePath });
              }
            }
            if (files.length > limit) {
              throw new Error(`La carpeta supera el límite inicial de ${limit} archivos.`);
            }
            active -= 1;
            next();
          })
          .catch((error: unknown) => {
            failed = true;
            reject(error);
          });
      }
    }

    next();
  });

  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath, "es"));
  return { files, folders };
}

/** Descarga el contenido, con avance si Drive dice cuánto ocupa. */
export async function downloadDriveFile(
  file: Pick<DriveFileMeta, "id" | "mimeType">,
  token: string,
  options: DriveRequestOptions & { onProgress?: (loaded: number, total: number | null) => void } = {},
): Promise<Blob> {
  const response = await driveRequest(driveContentUrl(file), token, options);
  const length = Number(response.headers.get("content-length") ?? "");
  const total = Number.isFinite(length) && length > 0 ? length : null;
  const type = response.headers.get("content-type") ?? "";

  if (!response.body || !options.onProgress) return response.blob();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    options.onProgress(loaded, total);
  }
  return new Blob(chunks as BlobPart[], { type });
}

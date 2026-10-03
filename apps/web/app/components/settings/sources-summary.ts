import type { AvailabilityState } from "../../library/documents";

/** «245 MB», «12,3 GB»: con coma decimal y sin decimales cuando sobran. */
export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  // En GB el decimal importa («12,3 GB» de cuota); en MB y KB solo por debajo de 10.
  const digits = unit === 0 ? 0 : unit >= 3 ? 1 : value >= 10 ? 0 : 1;
  return `${value.toLocaleString("es", { maximumFractionDigits: digits, minimumFractionDigits: digits })} ${units[unit]}`;
}

export type PermissionTone = "error" | "ok" | "warn";

/** El permiso de lectura de una carpeta, dicho para una persona. */
export function folderPermission(permission: "denied" | "granted" | "prompt") {
  if (permission === "granted") return { action: false, label: "Con permiso", tone: "ok" as PermissionTone };
  if (permission === "prompt") {
    return { action: true, label: "Pide permiso: sus libros no se abren hasta darlo", tone: "warn" as PermissionTone };
  }
  return { action: true, label: "Sin permiso: el navegador lo denegó", tone: "error" as PermissionTone };
}

/** Archivos sueltos o copias importadas: cuántos, cuánto ocupan y cuántos piden permiso. */
export function summarizeFiles(documents: ReadonlyArray<{ availability: AvailabilityState; sizeBytes?: number }>) {
  return {
    bytes: documents.reduce((sum, document) => sum + (document.sizeBytes ?? 0), 0),
    count: documents.length,
    needPermission: documents.filter((document) => document.availability === "disconnected").length,
  };
}

export interface DriveSummaryInput {
  authorized: boolean;
  configured: boolean;
  email: string | null;
  files: number;
  folders: number;
  readonly: boolean;
  tokenReady: boolean;
}

/** Google Drive en una frase y sus detalles, según esté sin configurar, sin conectar o conectado. */
export function describeDrive(drive: DriveSummaryInput) {
  if (!drive.configured) {
    return { details: [], headline: "No está disponible en esta instalación de Pliegue.", state: "unconfigured" as const };
  }
  const content = `${drive.folders} ${drive.folders === 1 ? "carpeta" : "carpetas"} · ${drive.files} ${drive.files === 1 ? "archivo" : "archivos"}`;
  if (!drive.authorized) {
    return drive.files > 0
      ? {
          details: [content],
          headline: `Desconectado: tus ${drive.files} archivos de Drive siguen en la biblioteca y se abren al volver a conectar.`,
          state: "disconnected" as const,
        }
      : { details: [], headline: "Sin conectar.", state: "disconnected" as const };
  }
  return {
    details: [
      content,
      drive.readonly
        ? "Permiso: leer las carpetas que vinculas, sin poder cambiar nada."
        : "Permiso: solo los archivos que eliges, uno a uno.",
      drive.tokenReady
        ? "Sesión activa en esta pestaña."
        : "La sesión de Google dura una hora: al abrir un libro o buscar cambios se reconecta con un clic.",
    ],
    headline: drive.email ? `Conectado como ${drive.email}.` : "Conectado.",
    state: "connected" as const,
  };
}

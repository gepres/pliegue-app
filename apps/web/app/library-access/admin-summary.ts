/**
 * Lo que el panel de administración de la biblioteca general calcula a partir de los códigos y
 * del registro de entradas. Puro: lo prueban los tests y lo pinta el panel.
 */
export interface AccessCodeRow {
  active: boolean;
  code: string;
  created_at: string;
  expires_at: string | null;
  id: string;
  label: string;
  max_uses: number | null;
  uses: number;
}

export interface AccessEventRow {
  code_id: string;
  created_at: string;
  device_id: string;
  id: number;
  user_agent: string;
  visitor_name: string;
}

export type CodeStatus = "active" | "disabled" | "exhausted" | "expired";

export const codeStatusLabels: Record<CodeStatus, string> = {
  active: "Activo",
  disabled: "Desactivado",
  exhausted: "Agotado",
  expired: "Caducado",
};

export function codeStatus(code: AccessCodeRow, now = Date.now()): CodeStatus {
  if (!code.active) return "disabled";
  if (code.expires_at && Date.parse(code.expires_at) <= now) return "expired";
  if (code.max_uses !== null && code.uses >= code.max_uses) return "exhausted";
  return "active";
}

export interface CodeSummary {
  /** Equipos distintos que entraron con el código. */
  devices: number;
  lastEntry: string | null;
  /** Nombres distintos (sin distinguir mayúsculas ni espacios). */
  people: number;
}

export function summarizeCodes(codes: readonly AccessCodeRow[], events: readonly AccessEventRow[]) {
  const summaries = new Map<string, CodeSummary>();
  for (const code of codes) {
    const own = events.filter((event) => event.code_id === code.id);
    summaries.set(code.id, {
      devices: new Set(own.map((event) => event.device_id)).size,
      lastEntry: own.reduce<string | null>((latest, event) => (!latest || event.created_at > latest ? event.created_at : latest), null),
      people: new Set(own.map((event) => event.visitor_name.trim().toLocaleLowerCase("es"))).size,
    });
  }
  return summaries;
}

/** «Chrome en Windows», «Safari en iPhone»: suficiente para reconocer un equipo. */
export function describeBrowser(userAgent: string) {
  const agent = userAgent || "";
  const browser = /Edg\//.test(agent)
    ? "Edge"
    : /OPR\/|Opera/.test(agent)
      ? "Opera"
      : /Firefox\//.test(agent)
        ? "Firefox"
        : /SamsungBrowser\//.test(agent)
          ? "Samsung Internet"
          : /Chrome\/|CriOS\//.test(agent)
            ? "Chrome"
            : /Safari\//.test(agent)
              ? "Safari"
              : null;
  const system = /iPhone/.test(agent)
    ? "iPhone"
    : /iPad/.test(agent)
      ? "iPad"
      : /Android/.test(agent)
        ? "Android"
        : /Windows/.test(agent)
          ? "Windows"
          : /Mac OS X|Macintosh/.test(agent)
            ? "Mac"
            : /CrOS/.test(agent)
              ? "ChromeOS"
              : /Linux/.test(agent)
                ? "Linux"
                : null;
  if (browser && system) return `${browser} en ${system}`;
  return browser ?? system ?? "Navegador desconocido";
}

const months = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SET", "OCT", "NOV", "DIC"];
/** Sin 0/O ni 1/I/L: se dictan y se copian sin confundirse. */
const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/**
 * Un código nuevo: el mes, el año y un lugar o grupo si se da («OCT2026AREQUIPA»), y si no,
 * cuatro caracteres al azar («OCT2026-K7QM»).
 */
export function suggestAccessCode(date: Date, place = "", random: (max: number) => number = (max) => crypto.getRandomValues(new Uint32Array(1))[0]! % max) {
  const prefix = `${months[date.getMonth()]}${date.getFullYear()}`;
  const cleaned = place
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 40 - prefix.length);
  if (cleaned) return `${prefix}${cleaned}`;
  let tail = "";
  for (let index = 0; index < 4; index += 1) tail += alphabet[random(alphabet.length)];
  return `${prefix}-${tail}`;
}

export function accessLink(origin: string, code: string) {
  return `${origin.replace(/\/+$/, "")}/biblioteca/general/${encodeURIComponent(code)}`;
}

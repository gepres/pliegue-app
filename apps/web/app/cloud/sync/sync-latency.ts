/**
 * Cuánto tarda un cambio en llegar a otro equipo (06.3, SLO del gate 5: 60 s en el p95).
 *
 * Se mide en dos tramos, cada uno con un solo reloj:
 * - Subir: desde que la persona cambia algo aquí hasta que la nube lo tiene (reloj de este equipo).
 * - Bajar: desde que la nube lo tiene hasta que este equipo lo recibe. La nube fecha cada fila con
 *   su hora; para compararla con la de aquí se estima el desfase con lo que devuelve cada subida.
 *
 * Solo cuenta lo que pasa con el equipo conectado: lo acumulado con la app cerrada o sin red no
 * es latencia del sistema, y el SLO es «con conexión».
 */

export const sloSeconds = 60;
/** Cuántas medidas se guardan de cada tramo. */
export const maxSamples = 100;
/** Más que esto no es latencia: el equipo estaba cerrado o sin red. */
export const maxSampleMs = 10 * 60 * 1000;
/** Una bajada solo cuenta si la vuelta anterior fue hace menos que esto (estaba al tanto). */
export const recentSyncMs = 90 * 1000;

export interface LatencyState {
  /** Bajar: ms desde que la nube tiene el cambio hasta que llega aquí. */
  down: number[];
  /** Desfase estimado: hora del servidor − hora de aquí, en ms; null mientras no se sabe. */
  skewMs: number | null;
  /** Últimas estimaciones del desfase, para quedarse con la mediana. */
  skews: number[];
  /** Subir: ms desde el cambio aquí hasta que la nube lo tiene. */
  up: number[];
}

export const emptyLatency = (): LatencyState => ({ down: [], skewMs: null, skews: [], up: [] });

export function percentile(values: readonly number[], p: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? null;
}

const median = (values: readonly number[]) => percentile(values, 50);
const keep = (values: readonly number[], added: readonly number[]) => [...values, ...added].slice(-maxSamples);

/**
 * Lo que dice una subida: el desfase (la hora del servidor de lo subido frente a la mitad de la
 * subida aquí) y, si había un cambio esperando, cuánto tardó en llegar a la nube.
 */
export function afterPush(
  state: LatencyState,
  push: { endedAt: number; serverTimes: readonly string[]; startedAt: number },
  changedAt: number | null,
): LatencyState {
  const middle = (push.startedAt + push.endedAt) / 2;
  const offsets = push.serverTimes.map((time) => Date.parse(time) - middle).filter((value) => Number.isFinite(value));
  const skews = offsets.length ? keep(state.skews, [median(offsets) ?? 0]).slice(-9) : state.skews;
  const up = changedAt !== null && push.endedAt - changedAt >= 0 && push.endedAt - changedAt <= maxSampleMs
    ? keep(state.up, [push.endedAt - changedAt])
    : state.up;
  return { ...state, skewMs: skews.length ? median(skews) : state.skewMs, skews, up };
}

/**
 * Lo que llegó de otros equipos en esta vuelta. Sin desfase conocido, o si la vuelta anterior fue
 * hace mucho (el equipo no estaba al tanto), no se mide.
 */
export function afterPull(state: LatencyState, fresh: readonly string[], now: number, previousSyncAt: number | null): LatencyState {
  if (state.skewMs === null || previousSyncAt === null || now - previousSyncAt > recentSyncMs) return state;
  const serverNow = now + state.skewMs;
  const samples = fresh
    .map((time) => serverNow - Date.parse(time))
    .filter((value) => Number.isFinite(value) && value <= maxSampleMs)
    .map((value) => Math.max(0, value));
  return samples.length ? { ...state, down: keep(state.down, samples) } : state;
}

export interface LatencySummary {
  /** p95 de bajar, en segundos. */
  down: number | null;
  samples: { down: number; up: number };
  /** p95 de llegar a otro equipo: subir más bajar (cota alta: suma dos p95). */
  total: number | null;
  up: number | null;
}

export function summarizeLatency(state: LatencyState): LatencySummary {
  const up = percentile(state.up, 95);
  const down = percentile(state.down, 95);
  const seconds = (value: number | null) => (value === null ? null : Math.round(value / 100) / 10);
  return {
    down: seconds(down),
    samples: { down: state.down.length, up: state.up.length },
    total: up !== null && down !== null ? seconds(up + down) : null,
    up: seconds(up),
  };
}

export function parseLatency(value: unknown): LatencyState {
  if (!value || typeof value !== "object") return emptyLatency();
  const candidate = value as Record<string, unknown>;
  const numbers = (list: unknown) => (Array.isArray(list) ? list.filter((item): item is number => typeof item === "number" && Number.isFinite(item)) : []);
  return {
    down: numbers(candidate.down).slice(-maxSamples),
    skewMs: typeof candidate.skewMs === "number" && Number.isFinite(candidate.skewMs) ? candidate.skewMs : null,
    skews: numbers(candidate.skews).slice(-9),
    up: numbers(candidate.up).slice(-maxSamples),
  };
}

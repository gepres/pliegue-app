import { describe, expect, it } from "vitest";

import { afterPull, afterPush, emptyLatency, maxSampleMs, percentile, summarizeLatency } from "./sync-latency";

const iso = (ms: number) => new Date(ms).toISOString();
const t0 = Date.parse("2026-11-07T12:00:00.000Z");

describe("percentiles", () => {
  it("el p95 de una lista y nada sin medidas", () => {
    expect(percentile([], 95)).toBeNull();
    expect(percentile([5], 95)).toBe(5);
    expect(percentile(Array.from({ length: 100 }, (_, index) => index + 1), 95)).toBe(95);
  });
});

describe("subir", () => {
  it("estima el desfase con la hora del servidor de lo subido y mide desde el cambio", () => {
    // Este equipo va 2 s atrasado: el servidor fecha la fila 2 s más tarde que la mitad de la subida.
    const state = afterPush(emptyLatency(), { endedAt: t0 + 400, serverTimes: [iso(t0 + 2200)], startedAt: t0 }, t0 - 3000);
    expect(state.skewMs).toBe(2000);
    expect(state.up).toEqual([3400]);
  });

  it("sin cambio esperando, solo corrige el reloj; un cambio de hace horas no es latencia", () => {
    expect(afterPush(emptyLatency(), { endedAt: t0, serverTimes: [], startedAt: t0 }, null).up).toEqual([]);
    expect(afterPush(emptyLatency(), { endedAt: t0, serverTimes: [], startedAt: t0 }, t0 - maxSampleMs - 1).up).toEqual([]);
  });
});

describe("bajar", () => {
  const known = { ...emptyLatency(), skewMs: 2000 };

  it("mide con la hora del servidor, corrigiendo el reloj de aquí", () => {
    // La nube lo tuvo a las 12:00:05 (su hora); aquí llega a las 12:00:10 de su hora (12:00:08 de aquí).
    const state = afterPull(known, [iso(t0 + 5000)], t0 + 8000, t0 - 30_000);
    expect(state.down).toEqual([5000]);
  });

  it("sin desfase conocido o con el equipo desconectado un rato, no mide", () => {
    expect(afterPull(emptyLatency(), [iso(t0)], t0 + 1000, t0 - 1000).down).toEqual([]);
    expect(afterPull(known, [iso(t0)], t0 + 1000, t0 - 5 * 60_000).down).toEqual([]);
    expect(afterPull(known, [iso(t0)], t0 + 1000, null).down).toEqual([]);
  });
});

describe("resumen", () => {
  it("el p95 de llegar a otro equipo es subir más bajar, en segundos", () => {
    const summary = summarizeLatency({ down: [4000, 9000, 12_000], skewMs: 0, skews: [0], up: [3200, 3400, 5000] });
    expect(summary).toEqual({ down: 12, samples: { down: 3, up: 3 }, total: 17, up: 5 });
    expect(summarizeLatency(emptyLatency()).total).toBeNull();
  });
});

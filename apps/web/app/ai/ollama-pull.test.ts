import { describe, expect, it } from "vitest";

import { describePullStatus, pullTracker } from "./ollama-pull";

describe("descarga de un modelo de Ollama", () => {
  it("el avance es lo bajado de todas las capas sobre lo que pesan todas", () => {
    const tracker = pullTracker();
    expect(tracker.line(`{"status":"pulling manifest"}`)).toEqual({ fraction: null, status: "Preparando la descarga…" });
    expect(tracker.line(`{"status":"pulling a1","digest":"a1","total":800,"completed":200}`)).toEqual({ fraction: 0.25, status: "Descargando…" });
    // Aparece otra capa: el total crece y el avance se recalcula con las dos.
    expect(tracker.line(`{"status":"pulling b2","digest":"b2","total":200,"completed":0}`)?.fraction).toBeCloseTo(0.2);
    expect(tracker.line(`{"status":"pulling a1","digest":"a1","total":800,"completed":800}`)?.fraction).toBeCloseTo(0.8);
    expect(tracker.line(`{"status":"verifying sha256 digest"}`)?.status).toBe("Comprobando lo descargado…");
    expect(tracker.line(`{"status":"success"}`)).toEqual({ fraction: 1, status: "Descargado" });
  });

  it("una línea vacía o rota no cuenta; un error de Ollama se lanza", () => {
    const tracker = pullTracker();
    expect(tracker.line("")).toBeNull();
    expect(tracker.line("{roto")).toBeNull();
    expect(() => tracker.line(`{"error":"pull model manifest: file does not exist"}`)).toThrow("file does not exist");
  });

  it("dice cada paso en español", () => {
    expect(describePullStatus("writing manifest")).toBe("Terminando…");
    expect(describePullStatus("algo nuevo")).toBe("Descargando…");
  });
});

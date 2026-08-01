import { describe, expect, it } from "vitest";

import {
  reconcileReadingProgress,
  type ReadingProgressRecord,
} from "./reading-progress-store";

function progress(
  percent: number,
  updatedAt = "2026-08-01T12:00:00.000Z",
): ReadingProgressRecord {
  return {
    documentId: "document-1",
    format: "epub",
    origin: "local",
    percent,
    title: "Documento real",
    updatedAt,
  };
}

describe("reconcileReadingProgress", () => {
  it("crea un progreso normalizado", () => {
    expect(reconcileReadingProgress(undefined, progress(120)).percent).toBe(100);
  });

  it("ignora una actualización anterior aunque tenga más avance", () => {
    const current = progress(40, "2026-08-01T12:00:00.000Z");
    const stale = progress(80, "2026-08-01T11:59:00.000Z");

    expect(reconcileReadingProgress(current, stale)).toBe(current);
  });

  it("evita que un conflicto nuevo reduzca el avance", () => {
    const merged = reconcileReadingProgress(
      progress(65),
      progress(30, "2026-08-01T12:01:00.000Z"),
    );

    expect(merged.percent).toBe(65);
    expect(merged.updatedAt).toBe("2026-08-01T12:01:00.000Z");
  });

  it("acepta un avance posterior", () => {
    expect(
      reconcileReadingProgress(
        progress(20),
        progress(48, "2026-08-01T12:01:00.000Z"),
      ).percent,
    ).toBe(48);
  });

  it("permite reiniciar solo cuando la acción es explícita", () => {
    expect(
      reconcileReadingProgress(
        progress(72),
        progress(0, "2026-08-01T12:01:00.000Z"),
        true,
      ).percent,
    ).toBe(0);
  });
});

import { describe, expect, it } from "vitest";

import {
  migrateProgressEntries,
  reconcileReadingProgress,
  type ReadingProgressRecord,
} from "./reading-progress-store";
import type { DocumentFormat } from "./documents";

function progress(
  percent: number,
  updatedAt = "2026-08-01T12:00:00.000Z",
  format: DocumentFormat = "epub",
): ReadingProgressRecord {
  return {
    documentId: `document-${format}`,
    format,
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

describe("migración del avance guardado", () => {
  const stored = [
    progress(100, "2026-08-01T12:00:00.000Z", "pdf"),
    progress(65, "2026-08-01T12:00:00.000Z", "epub"),
    progress(30, "2026-08-01T12:00:00.000Z", "docx"),
  ];

  it("descarta el avance de los PDF medido antes de contar páginas", () => {
    // El caso real: un PDF de 49 páginas marcado como leído entero sin pasar de la primera,
    // porque se medía el desplazamiento de la página de la aplicación y no el del documento.
    const migrated = migrateProgressEntries(stored, 1);

    expect(migrated.map((entry) => entry.percent)).toEqual([0, 65, 30]);
    // El resto de campos se conservan: no se pierde el documento, solo su cifra falsa.
    expect(migrated[0]?.title).toBe("Documento real");
    expect(migrated[0]?.updatedAt).toBe("2026-08-01T12:00:00.000Z");
  });

  it("deja intacto lo ya guardado con el visor que cuenta páginas", () => {
    const migrated = migrateProgressEntries(stored, 2);

    expect(migrated.map((entry) => entry.percent)).toEqual([100, 65, 30]);
  });

  it("no muta el arreglo recibido", () => {
    migrateProgressEntries(stored, 1);

    expect(stored[0]?.percent).toBe(100);
  });
});

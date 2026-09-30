import { describe, expect, it } from "vitest";

import type { DocumentReference, LibraryDocument } from "./documents";
import { contentIndexVersion } from "./local-content-index";
import { findStaleIndexes, hasStaleIndex } from "./stale-index";

function document(
  id: string,
  reference: DocumentReference,
  indexVersion?: number,
): LibraryDocument {
  return {
    author: "Autora",
    availability: "available",
    format: "pdf",
    id,
    ...(indexVersion === undefined ? {} : { indexVersion }),
    meta: "",
    origin: "local",
    reference,
    tags: [],
    title: id,
  };
}

const folder = (id: string, sourceId: string, version?: number) =>
  document(id, { kind: "local-folder", relativePath: `${id}.pdf`, sourceId }, version);
const copy = (id: string, version?: number) =>
  document(id, { kind: "local-copy", storageId: id }, version);
const file = (id: string, version?: number) =>
  document(id, { kind: "local-file", referenceId: id }, version);

describe("índices que no produjo el extractor vigente", () => {
  it("solo señala los que traen una versión anterior o ninguna", () => {
    expect(hasStaleIndex(copy("al-dia", contentIndexVersion))).toBe(false);
    expect(hasStaleIndex(copy("vieja", contentIndexVersion - 1))).toBe(true);
    // Los documentos anteriores a que existiera el versionado no traen el campo.
    expect(hasStaleIndex(copy("sin-version"))).toBe(true);
  });

  it("ignora lo que no tiene índice local que rehacer", () => {
    const drive = document("remoto", { fileId: "abc", kind: "google-drive" });

    expect(hasStaleIndex(drive)).toBe(false);
    expect(findStaleIndexes([drive]).total).toBe(0);
  });

  it("agrupa por la acción que corresponde al origen de cada documento", () => {
    const report = findStaleIndexes([
      folder("a", "fuente-1", 1),
      folder("b", "fuente-1", 1),
      folder("c", "fuente-2", 1),
      copy("d", 1),
      file("e", 1),
      copy("al-dia", contentIndexVersion),
    ]);

    expect(report.total).toBe(5);
    // Ordenado por volumen: la acción que más documentos arregla va primero.
    expect(report.groups.map((group) => group.action)).toEqual([
      "rescan-folder",
      "reindex-copy",
      "relink-file",
    ]);
    expect(report.groups[0]).toMatchObject({
      count: 3,
      sourceIds: ["fuente-1", "fuente-2"],
    });
  });

  it("no informa de nada cuando el corpus entero está al día", () => {
    const report = findStaleIndexes([
      folder("a", "fuente-1", contentIndexVersion),
      copy("b", contentIndexVersion),
    ]);

    expect(report).toEqual({ groups: [], total: 0 });
  });
});

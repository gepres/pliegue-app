// @vitest-environment node
import "fake-indexeddb/auto";

import { describe, expect, it } from "vitest";

import type { LibraryDocument } from "./documents";
import {
  applyDuplicateMarks,
  dismissDuplicatePair,
  markDuplicate,
  readDuplicateDecisions,
  removeDuplicateDecisions,
  unmarkDuplicate,
} from "./duplicate-store";

const decisions = readDuplicateDecisions;

const book = (id: string, title: string): LibraryDocument => ({
  author: "",
  availability: "available",
  format: "pdf",
  id,
  meta: "",
  origin: "local",
  reference: { kind: "local-copy", storageId: id },
  tags: [],
  title,
});

describe("lo decidido sobre los libros repetidos (03.6)", () => {
  it("marca una copia, no encadena marcas, descarta parejas y lo aplica a la Biblioteca", async () => {
    await markDuplicate("gris", { id: "color", title: "Las plantas de los dioses" });
    await dismissDuplicatePair("diario", "estoicismo");
    let records = await decisions();
    expect(records.map((record) => record.key).sort()).toEqual(["dismiss:diario|estoicismo", "mark:gris"]);

    // Las marcas no encadenan: si «color» pasa a ser la que se conserva de «nuevo»… y luego se
    // decide conservar «nuevo» en su lugar, «nuevo» deja de ser copia.
    await markDuplicate("nuevo", { id: "color", title: "Las plantas de los dioses" });
    await markDuplicate("color", { id: "nuevo", title: "Edición nueva" });
    records = await decisions();
    expect(records.some((record) => record.key === "mark:nuevo")).toBe(false);
    expect(records.some((record) => record.key === "mark:color")).toBe(true);

    const shown = applyDuplicateMarks([book("gris", "Plantas"), book("otro", "Otro")], records);
    expect(shown[0]!.organization?.duplicateOf).toBe("Las plantas de los dioses");
    expect(shown[1]!.organization).toBeUndefined();

    await unmarkDuplicate("gris");
    expect((await decisions()).some((record) => record.key === "mark:gris")).toBe(false);

    expect(await removeDuplicateDecisions(["diario", "nuevo"])).toBe(2);
    expect(await decisions()).toEqual([]);
  });
});

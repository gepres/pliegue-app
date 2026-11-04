import { describe, expect, it } from "vitest";

import { driveFolderMimeType, type DriveFileMeta } from "../drive/drive-files";
import { applyDriveChangePlan, planDriveChanges, type DriveChangePlan } from "./drive-changes";
import { createDriveDocument, type DriveDocument } from "./drive-document";
import { contentIndexVersion } from "./local-content-index";

const root = "root";
// La biblioteca: Filosofía/ y Filosofía/Estoicismo/ bajo la raíz.
const folders = { estoicismo: "Filosofía/Estoicismo", filosofia: "Filosofía", [root]: "" };

function pdf(id: string, name: string, parent: string, extra: Partial<DriveFileMeta> = {}): DriveFileMeta {
  return { id, md5Checksum: `md5-${id}`, mimeType: "application/pdf", modifiedTime: "2026-10-01T10:00:00.000Z", name, parents: [parent], size: "1000", ...extra };
}

function folder(id: string, name: string, parent: string): DriveFileMeta {
  return { id, mimeType: driveFolderMimeType, name, parents: [parent] };
}

function doc(file: DriveFileMeta, relativePath: string): DriveDocument {
  const document = createDriveDocument(file, { addedAt: "2026-10-01T00:00:00.000Z", relativePath, sourceId: "src", sourceName: "Libros" });
  if (!document) throw new Error("formato no legible en la prueba");
  return { ...document, indexedAt: "2026-10-02T00:00:00.000Z", indexStatus: "indexed", indexVersion: contentIndexVersion, searchText: `texto de ${file.name}` };
}

const plan = (changes: Parameters<typeof planDriveChanges>[0], known: string[] = []) =>
  planDriveChanges(changes, { folders, rootId: root }, new Set(known));

describe("«Buscar cambios» en Drive con changes.list: qué se hace con cada cambio", () => {
  it("un libro nuevo en una subcarpeta entra con su ruta relativa", () => {
    const result = plan([{ file: pdf("m1", "Meditaciones.pdf", "estoicismo"), fileId: "m1" }]);
    expect(result).toMatchObject({ kind: "apply", removals: [], upserts: [{ id: "m1", relativePath: "Filosofía/Estoicismo/Meditaciones.pdf" }] });
  });

  it("borrar, mandar a la papelera o sacar un libro del árbol lo quita; lo de fuera se ignora", () => {
    const result = plan(
      [
        { fileId: "a", removed: true },
        { file: pdf("b", "B.pdf", "filosofia", { trashed: true }), fileId: "b" },
        { file: pdf("c", "C.pdf", "otra-carpeta-ajena"), fileId: "c" },
        { file: pdf("ajeno", "Factura.pdf", "otra-carpeta-ajena"), fileId: "ajeno" },
      ],
      ["a", "b", "c"],
    );
    expect(result).toEqual({ folders, kind: "apply", removals: ["a", "b", "c"], upserts: [] });
  });

  it("mover o renombrar un libro dentro del árbol lo actualiza sin quitarlo; el último cambio manda", () => {
    const result = plan(
      [
        { file: pdf("q", "Quijote.pdf", "filosofia"), fileId: "q" },
        { file: pdf("q", "Don Quijote.pdf", root), fileId: "q" },
      ],
      ["q"],
    );
    expect(result).toMatchObject({ kind: "apply", removals: [], upserts: [{ id: "q", relativePath: "Don Quijote.pdf" }] });
  });

  it("una subcarpeta renombrada, movida, borrada o una carpeta nueva obligan a recorrer la carpeta", () => {
    const reasons = [
      plan([{ file: folder("filosofia", "Filosofía antigua", root), fileId: "filosofia" }]),
      plan([{ file: folder("estoicismo", "Estoicismo", root), fileId: "estoicismo" }]),
      plan([{ fileId: "estoicismo", removed: true }]),
      plan([{ file: folder("nueva", "Historia", root), fileId: "nueva" }]),
      plan([{ fileId: root, removed: true }]),
    ].map((result) => result.kind);
    expect(reasons).toEqual(["full", "full", "full", "full", "full"]);
  });

  it("renombrar la raíz, tocar una carpeta ajena o cambiar una unidad compartida no cambia nada", () => {
    const result = plan([
      { file: folder(root, "Mis libros", "padre"), fileId: root },
      { file: folder("ajena", "Fotos", "otra"), fileId: "ajena" },
      { changeType: "drive", fileId: "unidad" },
      { file: folder("filosofia", "Filosofía", root), fileId: "filosofia" },
    ]);
    expect(result).toEqual({ folders, kind: "apply", removals: [], upserts: [] });
  });

  it("demasiados cambios: se recorre la carpeta", () => {
    const many = Array.from({ length: 5_001 }, (_, index) => ({ fileId: `x${index}`, removed: true }));
    expect(plan(many).kind).toBe("full");
  });
});

describe("aplicar los cambios a los documentos de la carpeta", () => {
  const meditaciones = pdf("m1", "Meditaciones.pdf", "estoicismo");
  const quijote = pdf("q", "Quijote.pdf", "filosofia");
  const previous = [doc(meditaciones, "Filosofía/Estoicismo/Meditaciones.pdf"), doc(quijote, "Filosofía/Quijote.pdf")];

  function apply(changePlan: DriveChangePlan, skippedFiles = [] as Parameters<typeof applyDriveChangePlan>[0]["skippedFiles"]) {
    if (changePlan.kind !== "apply") throw new Error("se esperaba un plan aplicable");
    return applyDriveChangePlan({ now: "2026-11-04T00:00:00.000Z", plan: changePlan, previous, skippedFiles, sourceId: "src", sourceName: "Libros" });
  }

  it("un movimiento conserva el documento (mismo id) con su ruta nueva y sin perder su índice", () => {
    const result = apply(plan([{ file: { ...quijote, name: "Quijote.pdf", parents: [root] }, fileId: "q" }], ["q", "m1"]));
    const moved = result.documents.find((document) => document.reference.fileId === "q")!;

    expect(moved.id).toBe(previous[1]!.id);
    expect(moved.relativePath).toBe("Quijote.pdf");
    expect(moved.addedAt).toBe("2026-10-01T00:00:00.000Z");
    // Mismo MD5: no se vuelve a descargar para indexarlo.
    expect(moved.indexStatus).toBe("indexed");
    expect(moved.searchText).toBe("texto de Quijote.pdf");
    expect(result.deleteIds).toEqual([]);
    expect(result.summary).toMatchObject({ added: 0, removed: 0, total: 2 });
  });

  it("si el contenido cambió (otro MD5), se vuelve a indexar", () => {
    const result = apply(plan([{ file: { ...quijote, md5Checksum: "md5-nuevo", size: "2000" }, fileId: "q" }], ["q", "m1"]));
    const changed = result.documents.find((document) => document.reference.fileId === "q")!;
    expect(changed.indexStatus).not.toBe("indexed");
    expect(result.summary).toMatchObject({ changed: 1 });
  });

  it("alta, baja y un archivo que Pliegue no lee: cada uno donde toca", () => {
    const result = apply(
      plan(
        [
          { file: pdf("d", "Discurso del método.pdf", "filosofia"), fileId: "d" },
          { fileId: "m1", removed: true },
          { file: { id: "z", mimeType: "application/zip", name: "Escaneos.zip", parents: ["filosofia"], size: "2048" }, fileId: "z" },
        ],
        ["m1", "q"],
      ),
      [{ fileId: "viejo", relativePath: "Filosofía/viejo.rar", size: 10 }],
    );

    expect(result.documents.map((document) => document.relativePath)).toEqual(["Filosofía/Discurso del método.pdf", "Filosofía/Quijote.pdf"]);
    expect(result.deleteIds).toEqual([previous[0]!.id]);
    expect(result.put.map((document) => document.reference.fileId)).toEqual(["d"]);
    expect(result.skippedFiles).toEqual([
      { fileId: "viejo", relativePath: "Filosofía/viejo.rar", size: 10 },
      { fileId: "z", relativePath: "Filosofía/Escaneos.zip", size: 2048 },
    ]);
    expect(result.summary).toEqual({ added: 1, changed: 0, removed: 1, total: 2, unchanged: 1 });
  });

  it("un omitido que se borra sale de la lista de omitidos", () => {
    const result = apply(plan([{ fileId: "viejo", removed: true }], ["viejo", "m1", "q"]), [
      { fileId: "viejo", relativePath: "Filosofía/viejo.rar", size: 10 },
    ]);
    expect(result.skippedFiles).toEqual([]);
    expect(result.documents).toHaveLength(2);
  });
});

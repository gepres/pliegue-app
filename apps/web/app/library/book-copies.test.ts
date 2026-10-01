import { describe, expect, it } from "vitest";

import {
  applyCopyGroups,
  contentKeyOf,
  copiesLabel,
  planCopyGroups,
  planCopyRelease,
  type CopyGroup,
} from "./book-copies";
import type { LibraryDocument } from "./documents";

function doc(id: string, kind: LibraryDocument["reference"]["kind"], availability: LibraryDocument["availability"] = "available"): LibraryDocument {
  const reference =
    kind === "google-drive"
      ? { fileId: id, kind }
      : kind === "local-folder"
        ? { kind, relativePath: `${id}.pdf`, sourceId: "s" }
        : kind === "local-file"
          ? { kind, referenceId: id }
          : { kind, storageId: id };
  return {
    author: "",
    availability,
    format: "pdf",
    id,
    meta: "",
    origin: kind === "google-drive" ? "drive" : "local",
    reference,
    tags: [],
    title: id,
  };
}

const keyA = contentKeyOf("a".repeat(64), 100) ?? "";
const keyB = contentKeyOf("b".repeat(64), 200) ?? "";
const none = () => false;

describe("un libro, varias copias", () => {
  it("solo agrupa por un SHA-256 válido y el tamaño", () => {
    expect(keyA).toBe(`sha256:${"a".repeat(64)}:100`);
    expect(contentKeyOf("A".repeat(64), 100)).toBe(keyA);
    expect(contentKeyOf("corto", 100)).toBeNull();
    expect(contentKeyOf("a".repeat(64), 0)).toBeNull();
    expect(contentKeyOf(null, 100)).toBeNull();
  });

  it("un grupo nuevo sin estado toma como principal la copia local", () => {
    const plan = planCopyGroups(
      [
        { contentKey: keyA, document: doc("drive-1", "google-drive") },
        { contentKey: keyA, document: doc("local-1", "local-folder") },
        { contentKey: keyB, document: doc("solo", "local-folder") },
        { contentKey: null, document: doc("sin-huella", "local-folder") },
      ],
      [],
      none,
    );
    expect(plan.groups).toEqual([{ canonicalId: "local-1", contentKey: keyA, copyIds: ["local-1", "drive-1"] }]);
    expect(plan.transfers).toEqual([]);
  });

  it("si ya hay notas en la copia de Drive, esa sigue siendo la principal: nada se mueve", () => {
    const plan = planCopyGroups(
      [
        { contentKey: keyA, document: doc("drive-1", "google-drive") },
        { contentKey: keyA, document: doc("local-1", "local-folder") },
      ],
      [],
      (id) => id === "drive-1",
    );
    expect(plan.groups[0]?.canonicalId).toBe("drive-1");
    expect(plan.transfers).toEqual([]);
  });

  it("si las dos copias tienen estado, se juntan en la preferida", () => {
    const plan = planCopyGroups(
      [
        { contentKey: keyA, document: doc("drive-1", "google-drive") },
        { contentKey: keyA, document: doc("local-1", "local-folder") },
      ],
      [],
      () => true,
    );
    expect(plan.groups[0]?.canonicalId).toBe("local-1");
    expect(plan.transfers).toEqual([{ from: "drive-1", reason: "merge", to: "local-1" }]);
  });

  it("un grupo conocido conserva su principal aunque llegue una copia preferida", () => {
    const previous: CopyGroup[] = [{ canonicalId: "drive-1", contentKey: keyA, copyIds: ["drive-1", "copia-1"] }];
    const plan = planCopyGroups(
      [
        { contentKey: keyA, document: doc("drive-1", "google-drive") },
        { contentKey: keyA, document: doc("copia-1", "local-copy") },
        { contentKey: keyA, document: doc("local-1", "local-folder") },
      ],
      previous,
      (id) => id === "local-1",
    );
    expect(plan.groups[0]).toEqual({ canonicalId: "drive-1", contentKey: keyA, copyIds: ["local-1", "copia-1", "drive-1"] });
    // La copia nueva traía su propio estado: se junta con la principal.
    expect(plan.transfers).toEqual([{ from: "local-1", reason: "merge", to: "drive-1" }]);
  });

  it("si la principal desaparece, su estado pasa a una de las que quedan", () => {
    const previous: CopyGroup[] = [{ canonicalId: "local-1", contentKey: keyA, copyIds: ["local-1", "drive-1", "copia-1"] }];
    const plan = planCopyGroups(
      [
        { contentKey: keyA, document: doc("drive-1", "google-drive") },
        { contentKey: keyA, document: doc("copia-1", "local-copy") },
      ],
      previous,
      none,
    );
    expect(plan.groups[0]?.canonicalId).toBe("copia-1");
    expect(plan.transfers).toEqual([{ from: "local-1", reason: "successor", to: "copia-1" }]);

    // Y si solo queda una copia, el grupo desaparece pero el estado también se traslada.
    const alone = planCopyGroups([{ contentKey: keyA, document: doc("drive-1", "google-drive") }], previous, none);
    expect(alone.groups).toEqual([]);
    expect(alone.transfers).toEqual([{ from: "local-1", reason: "successor", to: "drive-1" }]);
  });

  it("al desvincular la principal, el estado pasa a la copia que queda", () => {
    const groups: CopyGroup[] = [
      { canonicalId: "local-1", contentKey: keyA, copyIds: ["local-1", "drive-1"] },
      { canonicalId: "local-2", contentKey: keyB, copyIds: ["local-2", "drive-2"] },
    ];
    const documents = new Map([doc("local-1", "local-folder"), doc("drive-1", "google-drive"), doc("local-2", "local-folder"), doc("drive-2", "google-drive")].map((d) => [d.id, d]));
    const plan = planCopyRelease(groups, ["local-1", "drive-2"], documents);
    expect(plan.transfers).toEqual([{ from: "local-1", reason: "successor", to: "drive-1" }]);
    // Ninguno de los dos libros conserva dos copias: los grupos se disuelven.
    expect(plan.groups).toEqual([]);
    // Quitar todas las copias de un libro no traslada nada: no queda a quién.
    expect(planCopyRelease(groups, ["local-1", "drive-1"], documents).transfers).toEqual([]);
  });

  it("muestra un documento por libro, con sus copias y la mejor disponibilidad", () => {
    const groups: CopyGroup[] = [{ canonicalId: "drive-1", contentKey: keyA, copyIds: ["local-1", "drive-1"] }];
    const shown = applyCopyGroups(
      [doc("local-1", "local-folder", "disconnected"), doc("drive-1", "google-drive", "available"), doc("otro", "local-file")],
      groups,
    );
    expect(shown.map((document) => document.id)).toEqual(["drive-1", "otro"]);
    expect(shown[0]?.availability).toBe("available");
    expect(shown[0]?.copies?.map((copy) => copy.id)).toEqual(["local-1", "drive-1"]);
    expect(copiesLabel(shown[0]?.copies ?? [])).toBe("Local · Drive");
  });
});

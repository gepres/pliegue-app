import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { buildCopiesArchive, copiesArchiveName, uniqueEntryNames } from "./copies-export";

describe("exportar las copias importadas en un ZIP", () => {
  it("no deja que dos copias con el mismo nombre se pisen, ni caracteres que Windows rechaza", () => {
    expect(uniqueEntryNames(["Libro.pdf", "libro.pdf", "LIBRO.pdf", "Otro.epub"])).toEqual([
      "Libro.pdf",
      "libro (2).pdf",
      "LIBRO (3).pdf",
      "Otro.epub",
    ]);
    expect(uniqueEntryNames(["a/b:c?.pdf", "   ", ".oculto"])).toEqual(["a_b_c_.pdf", "copia", "oculto"]);
  });

  it("guarda cada archivo tal cual, con su nombre en UTF-8, e informa del avance", async () => {
    const progress: string[] = [];
    const archive = await buildCopiesArchive(
      [
        { blob: new Blob(["%PDF-1.7 física"]), lastModified: Date.UTC(2026, 9, 1), name: "Física cuántica.pdf" },
        { blob: new Blob(["epub"]), name: "Física cuántica.pdf" },
        { blob: new Blob([new Uint8Array(200_000).fill(7)]), lastModified: 0, name: "grande.docx" },
      ],
      (done, total) => progress.push(`${done}/${total}`),
    );

    expect(archive.type).toBe("application/zip");
    const files = unzipSync(new Uint8Array(await archive.arrayBuffer()));
    expect(Object.keys(files)).toEqual(["Física cuántica.pdf", "Física cuántica (2).pdf", "grande.docx"]);
    expect(strFromU8(files["Física cuántica.pdf"]!)).toBe("%PDF-1.7 física");
    expect(files["grande.docx"]!.length).toBe(200_000);
    expect(progress).toEqual(["1/3", "2/3", "3/3"]);
    // Sin comprimir: el ZIP mide poco más que lo que lleva dentro.
    expect(archive.size).toBeGreaterThan(200_000);
  });

  it("nombra el archivo con la fecha", () => {
    expect(copiesArchiveName("2026-11-04T05:00:00.000Z")).toBe("pliegue-copias-2026-11-04.zip");
  });
});

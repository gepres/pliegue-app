import { Zip, ZipPassThrough } from "fflate";

/**
 * Exportar los originales permitidos (06.4): las copias importadas viven solo en este navegador,
 * así que son lo único que se perdería al borrarlo. Lo vinculado ya está en el disco y lo de
 * Drive, en Drive. Van en un ZIP sin comprimir: PDF, EPUB y DOCX ya lo están, y así no se gasta
 * tiempo ni memoria en volver a comprimirlos.
 */

export interface CopyEntry {
  blob: Blob;
  lastModified?: number;
  name: string;
}

/** El formato ZIP clásico no pasa de 4 GiB por archivo ni en total (fflate no escribe ZIP64). */
export const zipSizeLimit = 4 * 1024 ** 3 - 1;

export function copiesArchiveName(nowIso: string) {
  return `pliegue-copias-${nowIso.slice(0, 10)}.zip`;
}

/** Sin carpetas, sin caracteres que Windows no admite y sin nombres vacíos. */
function safeName(name: string) {
  const cleaned = Array.from(name.normalize("NFC"))
    .map((character) => (character.charCodeAt(0) < 32 || /[\\/:*?"<>|]/.test(character) ? "_" : character))
    .join("")
    .trim()
    .replace(/^\.+/, "");
  return cleaned || "copia";
}

/**
 * Dos copias con el mismo nombre (el mismo título en dos ediciones) no pueden pisarse en el ZIP:
 * la segunda pasa a «libro (2).pdf». Se compara sin distinguir mayúsculas, como Windows y macOS.
 */
export function uniqueEntryNames(names: readonly string[]) {
  const used = new Set<string>();
  return names.map((original) => {
    const name = safeName(original);
    const dot = name.lastIndexOf(".");
    const [stem, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
    let candidate = name;
    for (let copy = 2; used.has(candidate.toLocaleLowerCase("es")); copy += 1) {
      candidate = `${stem} (${copy})${extension}`;
    }
    used.add(candidate.toLocaleLowerCase("es"));
    return candidate;
  });
}

/** Un ZIP con las copias, leído archivo a archivo por trozos. */
export async function buildCopiesArchive(
  entries: readonly CopyEntry[],
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  const chunks: Uint8Array[] = [];
  let finish!: () => void;
  let fail!: (error: unknown) => void;
  const finished = new Promise<void>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  const zip = new Zip((error, data, final) => {
    if (error) return fail(error);
    chunks.push(data);
    if (final) finish();
  });

  const names = uniqueEntryNames(entries.map((entry) => entry.name));
  for (const [index, entry] of entries.entries()) {
    const file = new ZipPassThrough(names[index]!);
    // El ZIP no admite fechas anteriores a 1980: una fecha imposible se queda en la de hoy.
    if (entry.lastModified && new Date(entry.lastModified).getFullYear() >= 1980) file.mtime = entry.lastModified;
    zip.add(file);
    const reader = entry.blob.stream().getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      file.push(value);
    }
    file.push(new Uint8Array(0), true);
    onProgress?.(index + 1, entries.length);
  }
  zip.end();
  await finished;
  return new Blob(chunks as BlobPart[], { type: "application/zip" });
}

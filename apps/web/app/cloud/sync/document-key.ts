import type { LibraryDocument } from "../../library/documents";

/**
 * Identidad de un documento que vale en cualquier equipo.
 *
 * Cada equipo da a sus documentos un identificador al azar al vincularlos, así que el «doc-123»
 * de un equipo no dice nada en otro. Lo que sí coincide es el archivo: su nombre y su tamaño en
 * bytes. Con eso se empareja el mismo libro copiado a otro equipo. No se usa la fecha de
 * modificación: copiar un archivo o bajarlo de la nube la cambia.
 *
 * A la nube solo va el SHA-256 de esa identidad, no el nombre del archivo.
 */
export function documentIdentity(document: LibraryDocument): string | null {
  if (document.reference.kind === "google-drive") return `drive:${document.reference.fileId}`;

  const record = document as LibraryDocument & {
    originalName?: string;
    relativePath?: string;
    sizeBytes?: number;
  };
  const name =
    record.originalName ??
    (document.reference.kind === "local-folder"
      ? document.reference.relativePath.split("/").at(-1)
      : undefined);
  const size = record.sizeBytes;
  if (!name || typeof size !== "number" || size <= 0) return null;
  return `file:${name.normalize("NFC").trim().toLocaleLowerCase("es")}:${size}`;
}

const digests = new Map<string, string>();

async function sha256(value: string) {
  const cached = digests.get(value);
  if (cached) return cached;
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const hex = [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  digests.set(value, hex);
  return hex;
}

export interface LibraryKeys {
  /** El documento de este equipo con esa clave. */
  documentByKey: Map<string, LibraryDocument>;
  keyById: Map<string, string>;
}

/** Las claves de toda la biblioteca de este equipo. Si dos archivos coinciden, vale el primero. */
export async function indexLibraryKeys(documents: readonly LibraryDocument[]): Promise<LibraryKeys> {
  const keys: LibraryKeys = { documentByKey: new Map(), keyById: new Map() };
  for (const document of documents) {
    const identity = documentIdentity(document);
    if (!identity) continue;
    const key = await sha256(identity);
    keys.keyById.set(document.id, key);
    if (!keys.documentByKey.has(key)) keys.documentByKey.set(key, document);
  }
  return keys;
}

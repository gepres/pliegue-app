import type { AvailabilityState, DocumentOrigin, DocumentReference, LibraryDocument } from "./documents";

/**
 * Un libro, varias copias.
 *
 * El mismo libro puede estar en una carpeta local y en Google Drive, o importado como copia.
 * Pliegue los reconoce por su contenido —el SHA-256 del archivo, que Drive da sin descargarlo
 * y que en local se calcula leyendo el archivo— y los muestra como un solo libro. Todo lo que
 * la persona hace con él (progreso, notas, favoritos, traducciones, ficha) se guarda con el id
 * de una sola copia, la **principal**, para que no haya dos estados que se contradigan.
 *
 * Por qué por contenido y no por nombre: dos archivos con el mismo nombre pueden ser
 * ediciones distintas, y entonces sus notas (ancladas a posiciones del archivo) no valdrían en
 * el otro. Con el mismo SHA-256 son el mismo archivo byte a byte.
 */

export type CopyKind = DocumentReference["kind"];

export interface CopyGroup {
  /** La copia que guarda el estado del libro. Solo cambia si esa copia deja de existir. */
  canonicalId: string;
  /** Todas las copias, la principal incluida. */
  copyIds: string[];
  /** `sha256:<hex>:<tamaño>`. */
  contentKey: string;
}

/** Una copia vista desde su libro: dónde está y si se puede abrir ahora. */
export interface DocumentCopy {
  availability: AvailabilityState;
  id: string;
  kind: CopyKind;
  /** Dónde está, para mostrarlo: la ruta en la carpeta o en Drive, o «Copia importada». */
  location: string;
  origin: DocumentOrigin;
}

/**
 * Qué copia se prefiere para leer cuando hay varias disponibles: la local primero, porque se
 * abre al instante y sin conexión; Drive al final, porque hay que descargarla.
 */
const kindPreference: Record<CopyKind, number> = {
  "local-folder": 0,
  "local-file": 1,
  "local-copy": 2,
  "google-drive": 3,
};

export function compareCopyPreference(left: Pick<LibraryDocument, "id" | "reference">, right: Pick<LibraryDocument, "id" | "reference">) {
  return kindPreference[left.reference.kind] - kindPreference[right.reference.kind] || left.id.localeCompare(right.id);
}

export function contentKeyOf(sha256: string | null | undefined, size: number | null | undefined) {
  if (!sha256 || !/^[0-9a-f]{64}$/i.test(sha256) || !size || size <= 0) return null;
  return `sha256:${sha256.toLowerCase()}:${size}`;
}

function copyLocation(document: LibraryDocument) {
  const record = document as LibraryDocument & { originalName?: string; relativePath?: string };
  if (document.reference.kind === "local-copy") return "Copia importada en este navegador";
  return record.relativePath ?? record.originalName ?? document.title;
}

export function toDocumentCopy(document: LibraryDocument): DocumentCopy {
  return {
    availability: document.availability,
    id: document.id,
    kind: document.reference.kind,
    location: copyLocation(document),
    origin: document.origin,
  };
}

/** Cambios que el conciliador debe aplicar al estado guardado, en este orden. */
export interface CopyGroupPlan {
  groups: CopyGroup[];
  /**
   * Traslados de estado de una copia a la principal. `merge`: dos copias tenían estado propio
   * y se juntan. `successor`: la principal dejó de existir y su estado pasa a otra copia.
   */
  transfers: Array<{ from: string; reason: "merge" | "successor"; to: string }>;
}

/**
 * Agrupa las copias con el mismo contenido.
 *
 * - Un grupo ya conocido conserva su principal mientras exista.
 * - Un grupo nuevo elige como principal la copia que ya tiene estado (si varias lo tienen, la
 *   preferida para leer, y el estado de las demás se le traslada); si ninguna lo tiene, la
 *   preferida para leer.
 * - Si la principal desapareció pero quedan copias, su estado pasa a la preferida de las que
 *   quedan: el estado sigue guardado con el id viejo hasta que se traslada.
 * - Un grupo que se queda con una sola copia deja de existir; si esa copia no era la
 *   principal, hereda el estado.
 */
export function planCopyGroups(
  documents: readonly { contentKey: string | null; document: LibraryDocument }[],
  previous: readonly CopyGroup[],
  hasState: (documentId: string) => boolean,
): CopyGroupPlan {
  const byKey = new Map<string, LibraryDocument[]>();
  for (const { contentKey, document } of documents) {
    if (!contentKey) continue;
    const bucket = byKey.get(contentKey) ?? [];
    bucket.push(document);
    byKey.set(contentKey, bucket);
  }

  const present = new Set(documents.map((entry) => entry.document.id));
  const previousByKey = new Map(previous.map((group) => [group.contentKey, group]));
  const groups: CopyGroup[] = [];
  const transfers: CopyGroupPlan["transfers"] = [];

  for (const [contentKey, copies] of byKey) {
    const prior = previousByKey.get(contentKey);
    const sorted = [...copies].sort(compareCopyPreference);
    const ids = sorted.map((copy) => copy.id);

    if (copies.length < 2) {
      // Un grupo que se queda con una copia: si no era la principal, hereda su estado.
      const only = ids[0];
      if (prior && only && prior.canonicalId !== only && !present.has(prior.canonicalId)) {
        transfers.push({ from: prior.canonicalId, reason: "successor", to: only });
      }
      continue;
    }

    let canonicalId: string;
    if (prior && ids.includes(prior.canonicalId)) {
      canonicalId = prior.canonicalId;
      // Las copias que llegan al grupo con estado propio se juntan con la principal.
      for (const id of ids) {
        if (id !== canonicalId && !prior.copyIds.includes(id) && hasState(id)) {
          transfers.push({ from: id, reason: "merge", to: canonicalId });
        }
      }
    } else {
      const withState = ids.filter((id) => hasState(id));
      canonicalId = withState[0] ?? ids[0] ?? "";
      if (prior && !present.has(prior.canonicalId)) {
        transfers.push({ from: prior.canonicalId, reason: "successor", to: canonicalId });
      }
      for (const id of withState.slice(1)) transfers.push({ from: id, reason: "merge", to: canonicalId });
    }

    groups.push({ canonicalId, contentKey, copyIds: ids });
  }

  groups.sort((left, right) => left.contentKey.localeCompare(right.contentKey));
  return { groups, transfers };
}

/**
 * Antes de quitar copias a mano (desvincular, quitar de Drive, borrar una copia importada):
 * si alguna era la principal de un libro que conserva otras copias, su estado pasa a la
 * preferida de las que quedan. Sin esto, desvincular la carpeta local borraría las notas que
 * siguen valiendo para la copia de Drive.
 */
export function planCopyRelease(
  groups: readonly CopyGroup[],
  removedIds: readonly string[],
  documentsById: ReadonlyMap<string, Pick<LibraryDocument, "id" | "reference">>,
): CopyGroupPlan {
  const removed = new Set(removedIds);
  const next: CopyGroup[] = [];
  const transfers: CopyGroupPlan["transfers"] = [];

  for (const group of groups) {
    const survivors = group.copyIds
      .filter((id) => !removed.has(id))
      .map((id) => documentsById.get(id))
      .filter((document): document is Pick<LibraryDocument, "id" | "reference"> => Boolean(document))
      .sort(compareCopyPreference);
    const canonicalSurvives = survivors.some((document) => document.id === group.canonicalId);
    const successor = canonicalSurvives ? group.canonicalId : survivors[0]?.id;

    if (successor && successor !== group.canonicalId) {
      transfers.push({ from: group.canonicalId, reason: "successor", to: successor });
    }
    if (successor && survivors.length >= 2) {
      next.push({ ...group, canonicalId: successor, copyIds: survivors.map((document) => document.id) });
    }
  }

  return { groups: next, transfers };
}

const bestAvailability: AvailabilityState[] = ["available", "offline", "disconnected"];

/**
 * La biblioteca tal como se muestra: un documento por libro. La principal lleva la lista de
 * sus copias y se puede abrir si cualquiera de ellas se puede abrir.
 */
export function applyCopyGroups<Document extends LibraryDocument>(
  documents: readonly Document[],
  groups: readonly CopyGroup[],
): Document[] {
  if (!groups.length) return [...documents];
  const byId = new Map(documents.map((document) => [document.id, document]));
  const hidden = new Set<string>();
  const copiesOf = new Map<string, DocumentCopy[]>();

  for (const group of groups) {
    const members = group.copyIds
      .map((id) => byId.get(id))
      .filter((document): document is Document => Boolean(document));
    if (members.length < 2 || !byId.has(group.canonicalId)) continue;
    members.sort(compareCopyPreference);
    copiesOf.set(group.canonicalId, members.map(toDocumentCopy));
    for (const member of members) if (member.id !== group.canonicalId) hidden.add(member.id);
  }

  return documents
    .filter((document) => !hidden.has(document.id))
    .map((document) => {
      const copies = copiesOf.get(document.id);
      if (!copies) return document;
      const availability =
        bestAvailability.find((state) => copies.some((copy) => copy.availability === state)) ?? document.availability;
      return { ...document, availability, copies };
    });
}

/** «Local · Drive»: dónde está un libro, en el orden en que se prefiere leerlo. */
export function copiesLabel(copies: readonly Pick<DocumentCopy, "kind">[]) {
  const labels = copies.map((copy) => (copy.kind === "google-drive" ? "Drive" : copy.kind === "local-copy" ? "Copia" : "Local"));
  return [...new Set(labels)].join(" · ");
}

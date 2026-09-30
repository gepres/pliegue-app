import type { LibraryDocument } from "../library/documents";
import {
  catalogTemplateFileName,
  createCatalogTemplate,
  serializeCatalogTemplate,
} from "../library/catalog-template";

export function downloadJson(fileName: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.download = fileName;
  anchor.href = url;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * La plantilla JSON con la ficha que tenga cada documento —la de la IA o la importada—. La
 * descargan Fuentes y el panel de IA: después de catalogar es donde se revisa lo que dedujo el
 * modelo. Devuelve cuántas entradas lleva.
 */
export function downloadCatalogTemplate(documents: readonly LibraryDocument[]) {
  const template = createCatalogTemplate(documents);
  downloadJson(catalogTemplateFileName(template.generatedAt), serializeCatalogTemplate(template));
  return template.entries.length;
}

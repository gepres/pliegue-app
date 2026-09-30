import type { StructuredDocumentBlock } from "../../library/structured-document-extractor";
import { ExtractedBlock } from "../extracted-blocks";
import extracted from "../extracted-blocks.module.css";
import styles from "./parallel-blocks.module.css";

/**
 * Original y traducción en dos columnas, como una edición bilingüe: cada bloque empieza a la
 * altura de su traducción. Las dos columnas comparten las filas de la rejilla (subgrid), así
 * que un párrafo que en un idioma ocupa más no descuadra los siguientes.
 *
 * La columna del original es la del libro: ahí se subraya y se anota. La de la traducción se
 * marca con un ámbito vacío para que la selección se pueda copiar, pero no guardar como marca.
 */
export function ParallelBlocks({
  anchorOffset = 0,
  anchorPrefix,
  blocks,
  keyPrefix,
  language,
  pending,
  sectionTitle,
  sourceScope,
  translations,
}: {
  /** Puntos de lectura del original, los mismos que en la vista de una columna. */
  anchorPrefix?: string | undefined;
  anchorOffset?: number;
  blocks: readonly StructuredDocumentBlock[];
  /** Prefijo de la clave que une cada bloque con su traducción: `pdfr:12`, `sec:cap-3`. */
  keyPrefix: string;
  /** Idioma de la traducción, para el atributo `lang`. */
  language?: string | undefined;
  /** La traducción se está preparando: se avisa en la columna de la derecha. */
  pending: boolean;
  sectionTitle: string;
  /** Ámbito de las marcas de la columna original, si no lo pone ya un contenedor. */
  sourceScope?: { page: number; scope: string } | undefined;
  /** Un bloque traducido por cada bloque del original; `null` mientras no la hay. */
  translations: readonly StructuredDocumentBlock[] | null;
}) {
  const rows = Math.max(1, blocks.length);
  const span = { gridRow: `1 / span ${rows}` };

  return (
    <div className={styles.parallel} style={{ gridTemplateRows: `repeat(${rows}, auto)` }}>
      <div
        className={`${extracted.blocks} ${styles.column}`}
        data-annotation-page={sourceScope?.page}
        data-annotation-scope={sourceScope?.scope}
        style={span}
      >
        {blocks.map((block, index) => (
          <div className={styles.cell} key={`source-${index}`} {...linkProps(block, `${keyPrefix}:${index}`, "source")}>
            <ExtractedBlock
              anchor={anchorPrefix ? `${anchorPrefix}:${index + anchorOffset}` : undefined}
              block={block}
              sectionTitle={sectionTitle}
            />
          </div>
        ))}
      </div>
      <div
        className={`${extracted.blocks} ${styles.column} ${styles.translation}`}
        data-annotation-scope=""
        lang={translations ? language : undefined}
        style={span}
      >
        {blocks.map((block, index) => {
          const translated = translations?.[index];
          return translated ? (
            <div className={styles.cell} key={`target-${index}`} {...linkProps(translated, `${keyPrefix}:${index}`, "target")}>
              <ExtractedBlock block={translated} sectionTitle={sectionTitle} />
            </div>
          ) : (
            <div className={styles.cell} key={`target-${index}`}>
              {index === 0 && pending ? (
                <p className={styles.pending} role="status">
                  <span aria-hidden="true" className={styles.spinner} />
                  Traduciendo…
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Las tablas no se traducen: no tienen pareja que resaltar. */
function linkProps(block: StructuredDocumentBlock, key: string, side: "source" | "target") {
  return block.kind === "table" ? {} : { "data-parallel-key": key, "data-parallel-side": side };
}

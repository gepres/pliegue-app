import { Fragment, type ReactNode } from "react";

import type { StructuredDocumentBlock } from "../library/structured-document-extractor";
import { readingAnchorProps } from "./reader/reading-anchor";
import styles from "./extracted-blocks.module.css";

/**
 * Pinta el contenido que Pliegue ha extraído de un documento, sea cual sea su formato.
 *
 * Vive aparte del lector porque lo comparten dos caminos que llegan al mismo modelo: la
 * extracción estructurada de DOCX, EPUB, PPTX y XLSX, y la recomposición del texto de un
 * PDF. Que ambos se vean igual no es una coincidencia bonita: es lo que hace que cambiar de
 * formato no se note al leer.
 */
export function ExtractedBlock({
  anchor,
  block,
  sectionTitle,
}: {
  /** Punto de lectura del bloque, el mismo en todas las vistas: ver `useReadingPlace`. */
  anchor?: string | undefined;
  block: StructuredDocumentBlock;
  sectionTitle: string;
}) {
  const anchorProps = readingAnchorProps(anchor);

  if (block.kind === "heading") {
    return block.level <= 2 ? <h3 {...anchorProps}>{block.text}</h3> : <h4 {...anchorProps}>{block.text}</h4>;
  }

  if (block.kind === "paragraph") {
    return (
      <p {...anchorProps} className={block.caption ? styles.caption : undefined}>
        {block.text}
      </p>
    );
  }

  return (
    <div
      {...anchorProps}
      aria-label={`Tabla extraída de ${sectionTitle}`}
      className={styles.tableViewport}
      role="region"
      tabIndex={0}
    >
      <table>
        <tbody>
          {block.rows.map((row, rowIndex) => (
            <tr key={`row-${rowIndex}`}>
              {row.map((cell, cellIndex) => (
                <td key={`cell-${rowIndex}-${cellIndex}`}>{cell || "—"}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Algo que no es texto y va entre los bloques, como una ilustración del PDF en el modo Lectura
 * (05.6). `slot` es cuántos bloques van delante: 0, antes del primero; el total, al final.
 */
export interface BlockInsert {
  key: string;
  node: ReactNode;
  slot: number;
}

/** Lo que va justo delante del bloque `index`; con `index` igual al total, lo del final. */
export function insertsAt(inserts: readonly BlockInsert[] | undefined, index: number, total: number) {
  if (!inserts?.length) return null;
  const here = inserts.filter((insert) => (index >= total ? insert.slot >= total : insert.slot === index));
  return here.length ? here.map((insert) => <Fragment key={insert.key}>{insert.node}</Fragment>) : null;
}

export function ExtractedBlocks({
  anchorPrefix,
  anchorOffset = 0,
  blocks,
  inserts,
  sectionTitle,
}: {
  /** Prefijo de los puntos de lectura (`s3`, `p60`); sin él, los bloques no llevan. */
  anchorPrefix?: string | undefined;
  /** Posición del primer bloque en su sección, si se ha quitado alguno delante (el título). */
  anchorOffset?: number;
  blocks: readonly StructuredDocumentBlock[];
  /** Ilustraciones u otros elementos sin texto que van entre los bloques. */
  inserts?: readonly BlockInsert[] | undefined;
  sectionTitle: string;
}) {
  return (
    <div className={styles.blocks}>
      {blocks.map((block, index) => (
        <Fragment key={`${sectionTitle}-${block.kind}-${index}`}>
          {insertsAt(inserts, index, blocks.length)}
          <ExtractedBlock
            anchor={anchorPrefix ? `${anchorPrefix}:${index + anchorOffset}` : undefined}
            block={block}
            sectionTitle={sectionTitle}
          />
        </Fragment>
      ))}
      {insertsAt(inserts, blocks.length, blocks.length)}
    </div>
  );
}

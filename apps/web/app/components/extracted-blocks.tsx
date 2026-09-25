import type { StructuredDocumentBlock } from "../library/structured-document-extractor";
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
  block,
  sectionTitle,
}: {
  block: StructuredDocumentBlock;
  sectionTitle: string;
}) {
  if (block.kind === "heading") {
    return block.level <= 2 ? <h3>{block.text}</h3> : <h4>{block.text}</h4>;
  }

  if (block.kind === "paragraph") return <p>{block.text}</p>;

  return (
    <div
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

export function ExtractedBlocks({
  blocks,
  sectionTitle,
}: {
  blocks: readonly StructuredDocumentBlock[];
  sectionTitle: string;
}) {
  return (
    <div className={styles.blocks}>
      {blocks.map((block, index) => (
        <ExtractedBlock
          block={block}
          key={`${sectionTitle}-${block.kind}-${index}`}
          sectionTitle={sectionTitle}
        />
      ))}
    </div>
  );
}

import type { Metadata } from "next";

import { Card, Tag } from "@pliegue/ui";

import { LocalDocumentReader } from "../../../components/local-document-reader";
import { PageHeader } from "../../../components/workspace-page";
import styles from "../workspace.module.css";

export const metadata: Metadata = {
  title: "Lector",
  description: "Superficie de lectura de Pliegue con progreso y notas.",
};

interface ReaderPageProps {
  searchParams: Promise<{ document?: string | string[] }>;
}

export default async function ReaderPage({ searchParams }: ReaderPageProps) {
  const parameters = await searchParams;
  const documentId = Array.isArray(parameters.document)
    ? parameters.document[0]
    : parameters.document;

  if (documentId) return <LocalDocumentReader documentId={documentId} />;

  return (
    <>
      <PageHeader
        description="Una superficie de lectura tranquila que conserva progreso, notas y contexto."
        eyebrow="PDF · Página 86 de 224"
        title="Lector"
      />

      <div className={styles.readerLayout}>
        <article className={styles.readerPage}>
          <span>CAPÍTULO 3 · MÁS ALLÁ DE LA SOCIEDAD DISCIPLINARIA</span>
          <h2>La violencia de la positividad</h2>
          <p>
            La sociedad del siglo XXI ya no es disciplinaria, sino una sociedad de
            rendimiento. Sus habitantes tampoco se llaman ya «sujetos de obediencia»,
            sino sujetos de rendimiento. Estos sujetos son emprendedores de sí mismos.
          </p>
          <p>
            El poder ilimitado es el verbo modal positivo de la sociedad de rendimiento.
            Su plural afirmativo y colectivo se expresa en la fórmula «Yes, we can».
            Esta positividad transforma profundamente la experiencia del límite.
          </p>
          <p>
            Leer con atención implica recuperar ese límite: sostener una pregunta,
            conservar su procedencia y permitir que una idea dialogue con otras sin
            perder el texto que la originó.
          </p>
        </article>

        <aside className={styles.readerAside}>
          <Card>
            <Tag>Progreso</Tag>
            <h3>38 % leído</h3>
            <div
              aria-label="Progreso de lectura: 38 por ciento"
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={38}
              className={styles.progressTrack}
              role="progressbar"
            >
              <div className={styles.progressValue} />
            </div>
          </Card>
          <Card>
            <h3>Notas de esta página</h3>
            <ul>
              <li>Relacionar positividad con autoexigencia.</li>
              <li>Comparar con la sociedad disciplinaria.</li>
            </ul>
          </Card>
        </aside>
      </div>
    </>
  );
}

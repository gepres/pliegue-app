import type { Metadata } from "next";
import Link from "next/link";

import { buttonClassName, Card, Tag } from "@pliegue/ui";

import {
  DocumentCard,
  MetricCard,
  PageHeader,
} from "../../components/workspace-page";
import styles from "./workspace.module.css";

export const metadata: Metadata = {
  title: "Inicio",
  description: "Resumen del Área personal de Pliegue y lecturas recientes.",
};

const recentDocuments = [
  {
    eyebrow: "PDF · Drive",
    title: "Diseñar organizaciones para aprender",
    description: "Notas y conceptos sobre sistemas adaptativos.",
    meta: "Actualizado hoy",
  },
  {
    eyebrow: "EPUB · Local",
    title: "El oficio de pensar",
    description: "Lectura personal con 12 subrayados.",
    meta: "Página 86 de 214",
  },
  {
    eyebrow: "DOCX · Drive",
    title: "Hallazgos de investigación",
    description: "Síntesis del último ciclo de entrevistas.",
    meta: "8 conexiones",
  },
];

export default function WorkspaceHomePage() {
  return (
    <>
      <PageHeader
        actions={
          <>
            <Link
              className={buttonClassName({ variant: "secondary" })}
              href="/design-system"
            >
              Sistema visual
            </Link>
            <Link className={buttonClassName()} href="/app/biblioteca">
              Explorar biblioteca
            </Link>
          </>
        }
        description="Reúne Drive y archivos locales en un mismo lugar para leer, anotar y conectar conocimiento."
        eyebrow="Área unificada"
        title="Buenas noches, Genaro"
      />

      <section aria-label="Resumen del área" className={styles.metricGrid}>
        <MetricCard detail="Drive y archivos locales" label="Documentos" value="128" />
        <MetricCard detail="7 durante esta semana" label="Conexiones" value="34" />
        <MetricCard detail="Meta semanal al 82 %" label="Tiempo de lectura" value="4 h 12" />
      </section>

      <Card as="section" className={styles.continueCard}>
        <div>
          <Tag>Continúa leyendo · 38 %</Tag>
          <h2>La sociedad del cansancio</h2>
          <p>
            Retoma el capítulo «Más allá de la sociedad disciplinaria» exactamente
            donde lo dejaste. Tus notas y traducciones están disponibles sin conexión.
          </p>
          <Link className={buttonClassName()} href="/app/lector">
            Continuar en el lector
          </Link>
        </div>
        <div aria-hidden="true" className={styles.bookCover}>
          La sociedad del cansancio
        </div>
      </Card>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2>Documentos recientes</h2>
          <Link href="/app/biblioteca">Ver biblioteca</Link>
        </div>
        <div className={styles.documentGrid}>
          {recentDocuments.map((document) => (
            <DocumentCard
              eyebrow={document.eyebrow}
              key={document.title}
              title={document.title}
            >
              <p>{document.description}</p>
              <div className={styles.documentMeta}>
                <span>{document.meta}</span>
                <span>Disponible</span>
              </div>
            </DocumentCard>
          ))}
        </div>
      </section>
    </>
  );
}

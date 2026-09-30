"use client";

import Link from "next/link";

import { Card, Switch, Tag, buttonClassName, cx } from "@pliegue/ui";

import { useCatalogAi } from "../../ai/ai-readiness";
import { setGuideMuted, useGuideMuted } from "../../guide/guide-store";
import { useLibraryDocuments } from "../../library/use-library-documents";
import { Icon } from "../app-ui/icons";
import styles from "./first-steps.module.css";

interface Step {
  action: { href: string; label: string };
  done: boolean;
  text: string;
  title: string;
}

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/**
 * Primeros pasos, en Inicio. Es la otra mitad de los modales de «siguiente paso»: quien los
 * cierra sigue viendo aquí dónde está y qué le falta, marcado con el estado real de su
 * biblioteca. Desaparece cuando todo está hecho.
 */
export function FirstSteps() {
  const { allDocuments, importedCatalogs, loading } = useLibraryDocuments();
  const catalogAi = useCatalogAi();
  const muted = useGuideMuted();
  if (loading) return null;

  const total = allDocuments.length;
  const withCatalog = allDocuments.filter(
    (document) => document.catalogStatus === "analyzed" || document.catalogSource === "import",
  ).length;
  const withCategory = allDocuments.filter((document) => document.organization?.category).length;

  const steps: Step[] = [
    {
      action: { href: "/app/biblioteca/fuentes#carpetas", label: "Vincular una carpeta" },
      done: total > 0,
      text: total ? `${plural(total, "documento")} en tu biblioteca.` : "Vincula una carpeta o importa archivos: se quedan donde están.",
      title: "Añade tus documentos",
    },
    {
      action: { href: "/app/ajustes#ia", label: "Configurar una IA" },
      done: catalogAi.ready || importedCatalogs.records.length > 0,
      text: catalogAi.ready
        ? `${catalogAi.providerName} está lista para catalogar.`
        : importedCatalogs.records.length
          ? "Usas tu propio índice JSON."
          : "Tu IA con tu clave —o Ollama en tu equipo—, o un índice JSON si ya tienes las fichas.",
      title: "Elige cómo darles ficha",
    },
    {
      action: catalogAi.ready
        ? { href: "/app/ia", label: "Catalogar con IA" }
        : { href: "/app/biblioteca/fuentes#indice-json", label: "Importar un índice JSON" },
      done: withCatalog > 0,
      text: withCatalog
        ? `${withCatalog} de ${total} con ficha: autor, año, categoría…`
        : "Cada documento recibe su ficha: autor, año, categoría, serie.",
      title: "Cataloga tu biblioteca",
    },
    {
      action: { href: "/app/biblioteca", label: "Abrir la Biblioteca" },
      done: withCategory > 0,
      text: withCategory
        ? "Filtra por categoría, autor, serie o idioma."
        : "Con fichas, la Biblioteca se filtra por categoría, autor y serie.",
      title: "Explora por categorías",
    },
  ];

  const current = steps.findIndex((step) => !step.done);
  if (current === -1) return null;
  const doneCount = steps.filter((step) => step.done).length;

  return (
    <Card aria-labelledby="first-steps-title" as="section" className={styles.card} tone="subtle">
      <header className={styles.head}>
        <div>
          <Tag>
            Primeros pasos · {doneCount} de {steps.length}
          </Tag>
          <h2 id="first-steps-title">Tu biblioteca, en cuatro pasos</h2>
        </div>
        <Switch
          checked={!muted}
          className={styles.toggle}
          description="Al terminar cada paso, Pliegue te propone el siguiente."
          label="Sugerirme el paso siguiente"
          onChange={(event) => setGuideMuted(!event.target.checked)}
        />
      </header>

      <ol className={styles.steps}>
        {steps.map((step, index) => (
          <li
            aria-current={index === current ? "step" : undefined}
            className={cx(styles.step, step.done && styles.stepDone, index === current && styles.stepCurrent)}
            key={step.title}
          >
            <span aria-hidden="true" className={styles.marker}>
              {step.done ? <Icon name="check" size={16} /> : index + 1}
            </span>
            <div className={styles.stepBody}>
              <h3>
                {step.title}
                {step.done ? <span className={styles.visuallyHidden}> (hecho)</span> : null}
              </h3>
              <p>{step.text}</p>
              {index === current ? (
                <Link className={buttonClassName({ size: "sm" })} href={step.action.href}>
                  {step.action.label}
                </Link>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

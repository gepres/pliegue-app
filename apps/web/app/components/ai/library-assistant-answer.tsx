"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@pliegue/ui";

import { saveFindingAsNote, type AssistantFragment, type AssistantResult } from "../../ai/library-assistant";
import type { AnswerConfidence, FindingKind, VerifiedFinding } from "../../ai/library-answer";
import { describeLocation } from "../../library/chunking";
import { Icon } from "../app-ui/icons";
import styles from "./semantic-search-panel.module.css";

const count = (value: number, one: string, many: string) => `${value.toLocaleString("es")} ${value === 1 ? one : many}`;

const kindLabels: Record<FindingKind, string> = {
  inference: "Inferencia",
  source: "Del texto",
  unverified: "Sin cita verificable",
};

const confidenceLabels: Record<AnswerConfidence, string> = {
  high: "confianza alta",
  low: "confianza baja",
  medium: "confianza media",
};

export const fragmentHref = (fragment: AssistantFragment) =>
  `/app/lector?document=${encodeURIComponent(fragment.chunk.documentId)}&fragmento=${encodeURIComponent(fragment.chunk.id)}`;

function statusText(result: AssistantResult) {
  const { answer, sent } = result;
  if (answer.status === "no-evidence") {
    return sent ? "No encontré en tus libros nada que responda a esto." : "No hay fragmentos que se puedan enviar para responder a esto.";
  }
  const books = new Set(answer.findings.flatMap((finding) => finding.citations.map((citation) => citation.fragment.chunk.documentId))).size;
  const base = `Con ${count(sent, "fragmento", "fragmentos")} de tus libros${books ? `; cita ${count(books, "libro", "libros")}` : ""}.`;
  return answer.status === "partial" ? `Respuesta parcial: los fragmentos no lo cubren todo. ${base}` : base;
}

type NoteState = "saving" | "saved" | "error";

/**
 * La respuesta del asistente (04.5): lo que dice el texto, lo que se deduce y lo que no tiene una
 * cita comprobable, cada cosa con su confianza y sus citas, que abren el libro en su sitio.
 */
export function LibraryAssistantAnswer({ providerName, question, result }: { providerName: string; question: string; result: AssistantResult }) {
  // Por hallazgo: el aviso va junto a su botón, no al final de la respuesta, donde no se veía.
  const [notes, setNotes] = useState<Record<number, NoteState>>({});
  const { answer, keptLocal } = result;

  async function save(index: number, finding: VerifiedFinding<AssistantFragment>) {
    const citation = finding.citations[0];
    if (!citation || notes[index] === "saving" || notes[index] === "saved") return;
    setNotes((current) => ({ ...current, [index]: "saving" }));
    try {
      await saveFindingAsNote(finding, citation);
      setNotes((current) => ({ ...current, [index]: "saved" }));
    } catch {
      setNotes((current) => ({ ...current, [index]: "error" }));
    }
  }

  return (
    <section aria-label={`Respuesta a «${question}»`} className={styles.answer} data-status={answer.status}>
      <p className={styles.answerState} role="status">
        {statusText(result)}
      </p>
      {answer.summary ? <p className={styles.summary}>{answer.summary}</p> : null}
      {answer.findings.length ? (
        <ol className={styles.findings}>
          {answer.findings.map((finding, index) => (
            <li className={styles.finding} data-kind={finding.kind} key={index}>
              <p className={styles.findingHead}>
                <span className={styles.badge}>{kindLabels[finding.kind]}</span>
                <span className={styles.where}>{confidenceLabels[finding.confidence]}</span>
              </p>
              <p className={styles.findingText}>{finding.text}</p>
              {finding.citations.length ? (
                <ul className={styles.citations}>
                  {finding.citations.map((citation, position) => (
                    <li key={position}>
                      <Link href={fragmentHref(citation.fragment)}>«{citation.quote}»</Link>
                      <span className={styles.where}>
                        {citation.fragment.title}, {describeLocation(citation.fragment.location)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {finding.dropped ? (
                <p className={styles.note}>
                  Se {finding.dropped === 1 ? "quitó 1 cita" : `quitaron ${finding.dropped} citas`} que no estaba{finding.dropped === 1 ? "" : "n"} en el texto.
                </p>
              ) : null}
              {finding.citations[0] ? (
                <div className={styles.noteAction}>
                  <Button
                    aria-describedby={`finding-note-${index}`}
                    // aria-disabled y no disabled: el foco se queda en el botón al guardar.
                    aria-disabled={notes[index] === "saving" || notes[index] === "saved"}
                    onClick={() => void save(index, finding)}
                    size="sm"
                    variant="quiet"
                  >
                    {notes[index] === "saved" ? (
                      <>
                        <Icon name="check" size={16} /> Nota guardada
                      </>
                    ) : notes[index] === "saving" ? (
                      "Guardando…"
                    ) : (
                      "Guardar como nota"
                    )}
                  </Button>
                  <p aria-live="polite" className={styles.noteStatus} data-state={notes[index] ?? "idle"} id={`finding-note-${index}`} role="status">
                    {notes[index] === "saved" ? (
                      <>
                        En «{finding.citations[0].fragment.title}», {describeLocation(finding.citations[0].fragment.location)}, resaltada sobre la
                        cita. <Link href={fragmentHref(finding.citations[0].fragment)}>Verla en el lector</Link>
                      </>
                    ) : notes[index] === "error" ? (
                      "No se pudo guardar la nota. Vuelve a intentarlo."
                    ) : null}
                  </p>
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
      {answer.missing ? (
        <p className={styles.missing}>
          <strong>Lo que no aparece:</strong> {answer.missing}
        </p>
      ) : null}
      {keptLocal.length ? (
        <div className={styles.note}>
          <p>
            {count(keptLocal.length, "fragmento", "fragmentos")} de libros confidenciales o personales sin permiso no se
            {keptLocal.length === 1 ? " envió" : " enviaron"} a {providerName}. Puedes leerlos tú:
          </p>
          <ul className={styles.citations}>
            {keptLocal.map((fragment) => (
              <li key={fragment.chunk.id}>
                <Link href={fragmentHref(fragment)}>{fragment.title}</Link>
                <span className={styles.where}>{describeLocation(fragment.location)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

"use client";

import Link from "next/link";

import { Button } from "@pliegue/ui";

import { budgetProviderNames, priceKey } from "../../ai/ai-budget";
import { getSessionApiKey } from "../../ai/ai-session-secret-store";
import { askModelOf, askProviderOf } from "../../ai/ai-settings";
import { useAiSettings } from "../../ai/ai-settings-store";
import { planBookSummary, recordSummaryKeptLocal, saveBookSummaryNote, summarizeBook } from "../../ai/book-summarizer";
import { describeLocation } from "../../library/chunking";
import type { LibraryDocument } from "../../library/documents";
import { confirmAction } from "../app-ui/confirm-dialog";
import { fragmentHref } from "../ai/library-assistant-answer";
import { confirmPersonalSend } from "../ai/sensitive-consent";
import styles from "./book-summary.module.css";
import { readBookSummaryState, setBookSummaryState, useBookSummaryState } from "./book-summary-store";

const number = (value: number) => Math.round(value).toLocaleString("es");
const count = (value: number, one: string, many: string) => `${number(value)} ${value === 1 ? one : many}`;
const dollars = new Intl.NumberFormat("es", { currency: "USD", maximumFractionDigits: 4, minimumFractionDigits: 2, style: "currency" });

/**
 * «Resumir este libro» en el lector (04.5, opción «b» del dueño). Con el proveedor y el modelo de
 * «Preguntar»: avisa antes de lo que se envía y de lo que costará, resume por partes con citas
 * comprobadas y deja el resumen como nota del libro.
 */
export function BookSummaryPanel({ document }: { document: LibraryDocument }) {
  const settings = useAiSettings();
  const state = useBookSummaryState(document.id);
  const provider = askProviderOf(settings);
  const model = askModelOf(settings);
  const providerName = budgetProviderNames[provider] ?? provider;
  const busy = state.status === "preparing" || state.status === "running";

  async function start() {
    const id = document.id;
    if (busy) return;
    setBookSummaryState(id, { status: "preparing" });
    try {
      const planned = await planBookSummary(document, settings);
      if ("reason" in planned) {
        setBookSummaryState(id, {
          message:
            planned.reason === "too-long"
              ? `Es demasiado largo para resumirlo entero (${count(planned.characters ?? 0, "carácter", "caracteres")}). Pregunta por partes en IA → «Preguntar».`
              : planned.reason === "no-text"
                ? "Este libro no tiene texto que leer (¿es un escaneado?): no hay nada que resumir."
                : "Este formato no se puede resumir.",
          status: "error",
        });
        return;
      }
      const { plan } = planned;
      const name = budgetProviderNames[plan.provider] ?? plan.provider;
      if (plan.route === "block") {
        recordSummaryKeptLocal(document, plan);
        setBookSummaryState(id, {
          message: `Este libro es confidencial: no sale del equipo y ${name} está en la nube. Para resumirlo, elige Ollama en «Preguntar con» (Ajustes → IA).`,
          status: "blocked",
        });
        return;
      }
      const apiKey = getSessionApiKey(plan.provider);
      if (plan.provider !== "ollama" && !apiKey) {
        setBookSummaryState(id, { message: `Pon la clave de ${name} en Ajustes → IA para resumir.`, status: "error" });
        return;
      }
      if (plan.route === "ask" && !(await confirmPersonalSend([document], "summarize", name))) {
        recordSummaryKeptLocal(document, plan);
        setBookSummaryState(id, { status: "idle" });
        return;
      }
      if (plan.place === "cloud") {
        const price = settings.budget.tokenPrices[priceKey(plan.provider, plan.model)];
        const { inputTokens, outputTokens } = plan.estimate;
        const cost = price ? (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output : null;
        const confirmed = await confirmAction({
          confirmLabel: "Resumir",
          description: `Se envía a ${name} (${plan.model}) el texto de «${document.title}» en ${count(plan.parts, "parte", "partes")} y, después, sus ideas para juntarlas en el resumen.`,
          details: [
            `${count(plan.characters, "carácter", "caracteres")} · ${count(plan.parts, "parte", "partes")}`,
            cost !== null
              ? `Unos ${number(inputTokens)} tokens de entrada y ${number(outputTokens)} de salida: ~${dollars.format(cost)}`
              : `Unos ${number(inputTokens)} tokens de entrada y ${number(outputTokens)} de salida (sin precio en la tabla de Ajustes → IA)`,
          ],
          icon: "cloud",
          note: "Cuenta para el presupuesto y queda en el registro de la IA. El resumen se guarda como nota del libro.",
          title: "¿Resumir el libro entero?",
        });
        if (!confirmed) {
          setBookSummaryState(id, { status: "idle" });
          return;
        }
      }
      const abort = new AbortController();
      setBookSummaryState(id, { abort, progress: { done: 0, stage: "parts", total: plan.parts, waiting: null }, status: "running" });
      const result = await summarizeBook(document, plan, settings, apiKey, {
        onProgress: (progress) => setBookSummaryState(id, { abort, progress, status: "running" }),
        signal: abort.signal,
      });
      let noteId: string | null = null;
      try {
        noteId = (await saveBookSummaryNote(document, result, plan.model)).id;
      } catch {
        noteId = null;
      }
      setBookSummaryState(id, { model: plan.model, noteId, providerName: name, result, status: "done" });
    } catch (error) {
      const current = readBookSummaryState(id);
      const aborted = current.status === "running" && current.abort.signal.aborted;
      setBookSummaryState(id, {
        message: aborted ? "Se detuvo. No se guardó nada." : error instanceof Error ? error.message : "No se pudo resumir.",
        status: "error",
      });
    }
  }

  return (
    <div className={styles.panel}>
      <p className={styles.intro}>
        Lee el libro entero, por partes, con {providerName} ({model}) y te deja un resumen con citas comprobadas en el
        libro. Se guarda como nota.
      </p>

      {state.status === "running" ? (
        <div className={styles.running}>
          <p aria-live="polite" role="status">
            {state.progress.stage === "joining"
              ? "Juntando las ideas en el resumen…"
              : `Leyendo la parte ${Math.min(state.progress.done + 1, state.progress.total)} de ${state.progress.total}…`}
            {state.progress.waiting ? ` ${state.progress.waiting}` : ""}
          </p>
          <progress max={state.progress.total + 1} value={state.progress.done + (state.progress.stage === "joining" ? 1 : 0)} />
          <Button onClick={() => state.abort.abort()} size="sm" variant="secondary">
            Detener
          </Button>
        </div>
      ) : (
        <div className={styles.actions}>
          <Button disabled={busy} onClick={() => void start()} size="sm">
            {state.status === "preparing" ? "Preparando…" : state.status === "done" ? "Resumir otra vez" : "Resumir este libro"}
          </Button>
        </div>
      )}

      {state.status === "error" || state.status === "blocked" ? (
        <p className={styles.problem} data-status={state.status} role="alert">
          {state.message}
          {state.status === "blocked" ? (
            <>
              {" "}
              <Link href="/app/ajustes#ai-buscar">Ir a Ajustes → IA</Link>
            </>
          ) : null}
        </p>
      ) : null}

      {state.status === "done" ? (
        <section aria-label={`Resumen de «${document.title}»`} className={styles.result}>
          <p aria-live="polite" className={styles.saved} role="status">
            {state.noteId
              ? "Guardado como nota: está en Índice y detalles → Notas, resaltada sobre la primera cita."
              : "No se pudo guardar como nota; el resumen se ve aquí mientras no cierres el libro."}
          </p>
          {state.result.summary ? <p className={styles.summary}>{state.result.summary}</p> : null}
          <ol className={styles.points}>
            {state.result.points.map((point, index) => (
              <li key={index}>
                <p>{point.text}</p>
                <ul className={styles.citations}>
                  {point.citations.map((citation, position) => (
                    <li key={position}>
                      <Link href={fragmentHref(citation.fragment)}>«{citation.quote}»</Link>
                      <span className={styles.where}>{describeLocation(citation.fragment.location)}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
          <p className={styles.note}>
            Con {state.providerName} ({state.model}).
            {state.result.dropped
              ? ` Se ${state.result.dropped === 1 ? "quitó 1 cita o idea" : `quitaron ${state.result.dropped} citas o ideas`} que no estaba${state.result.dropped === 1 ? "" : "n"} en el libro.`
              : " Todas las citas se comprobaron en el libro."}
          </p>
        </section>
      ) : null}
    </div>
  );
}

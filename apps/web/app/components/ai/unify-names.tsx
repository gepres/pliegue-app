"use client";

import { useEffect, useState } from "react";

import { Button } from "@pliegue/ui";

import {
  applyNameReconciliation,
  planNameReconciliation,
  type NameReconciliationPlan,
} from "../../ai/catalog-analysis";
import type { DocumentCatalogRecord } from "../../ai/document-catalog";
import { Sheet } from "../app-ui/overlays";
import styles from "./unify-names.module.css";

/**
 * «Unificar nombres» con vista previa (03.6): junta las variantes de un mismo autor o de una
 * misma categoría, pero antes enseña cada unión y en qué fichas cae, y la persona puede dejar
 * fuera la que esté mal («J. Martínez» no siempre es «José Martínez»). Ya no se aplica sola al
 * terminar de catalogar: el panel avisa de que hay variantes y espera.
 */

const kindLabels = { author: "Autor", category: "Categoría" } as const;
const titlesShown = 3;

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

export function UnifyNames({
  disabled,
  onStatus,
  records,
}: {
  disabled: boolean;
  onStatus: (message: string) => void;
  /** Las fichas guardadas: cuando cambian, se vuelve a mirar qué habría que unificar. */
  records: readonly DocumentCatalogRecord[];
}) {
  const [plan, setPlan] = useState<NameReconciliationPlan | null>(null);
  const [open, setOpen] = useState(false);
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    let current = true;
    planNameReconciliation()
      .then((next) => {
        if (current) setPlan(next);
      })
      .catch(() => {
        if (current) setPlan(null);
      });
    return () => {
      current = false;
    };
  }, [records]);

  const merges = plan?.merges ?? [];
  const accepted = merges.filter((merge) => !excluded.has(merge.key));
  const touched = new Set(accepted.flatMap((merge) => merge.documentIds)).size;

  function review() {
    setExcluded(new Set());
    setOpen(true);
  }

  async function apply() {
    if (!plan) return;
    setApplying(true);
    try {
      const { skipped, updated } = await applyNameReconciliation(plan, new Set(accepted.map((merge) => merge.key)));
      onStatus(
        `${plural(updated, "ficha")} con el nombre unificado${
          skipped ? `; ${plural(skipped, "ficha")} cambió después de la vista previa y se dejó como estaba` : ""
        }.`,
      );
      setOpen(false);
      setPlan(await planNameReconciliation());
    } catch {
      onStatus("No fue posible unificar los nombres de las fichas.");
    } finally {
      setApplying(false);
    }
  }

  return (
    <>
      <p className={styles.pending} role="status">
        {plan === null
          ? "Revisando las fichas…"
          : merges.length
            ? `${plural(merges.length, "variante")} por unificar en ${plural(new Set(merges.flatMap((merge) => merge.documentIds)).size, "ficha")}.`
            : `Sin variantes que unificar en ${plural(plan.reviewed, "ficha")}.`}
      </p>
      <Button disabled={disabled || !merges.length} onClick={review} size="sm" variant="secondary">
        Revisar y unificar
      </Button>
      <Sheet
        description="Cada unión dice qué grafía se queda y en qué fichas cae. Desmarca la que no sea el mismo nombre. No se envía nada a la IA."
        footer={
          <div className={styles.footer}>
            <Button disabled={applying || !accepted.length} onClick={() => void apply()}>
              {applying ? "Unificando…" : `Unificar ${plural(touched, "ficha")}`}
            </Button>
            <Button disabled={applying} onClick={() => setOpen(false)} variant="quiet">
              Cancelar
            </Button>
          </div>
        }
        onClose={() => setOpen(false)}
        open={open}
        title="Unificar nombres"
        width={560}
      >
        <ul aria-label="Uniones propuestas" className={styles.merges}>
          {merges.map((merge) => {
            const id = `unir-${merge.key}`;
            const rest = merge.titles.length - titlesShown;
            return (
              <li className={styles.merge} key={merge.key}>
                <input
                  checked={!excluded.has(merge.key)}
                  id={id}
                  onChange={(event) =>
                    setExcluded((previous) => {
                      const next = new Set(previous);
                      if (event.target.checked) next.delete(merge.key);
                      else next.add(merge.key);
                      return next;
                    })
                  }
                  type="checkbox"
                />
                <label htmlFor={id}>
                  <span className={styles.kind}>{kindLabels[merge.kind]}</span>
                  <span className={styles.rename}>
                    <s>{merge.from}</s> → <strong>{merge.to}</strong>
                  </span>
                  <small>
                    {plural(merge.documentIds.length, "ficha")}: {merge.titles.slice(0, titlesShown).join(" · ")}
                    {rest > 0 ? ` y ${rest} más` : ""}
                  </small>
                </label>
              </li>
            );
          })}
        </ul>
      </Sheet>
    </>
  );
}

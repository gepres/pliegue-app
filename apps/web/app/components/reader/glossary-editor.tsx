"use client";

import { useState, type FormEvent } from "react";

import { Button, Input } from "@pliegue/ui";

import { languageName } from "../../library/translation";
import { glossaryLimits } from "../../library/translation-glossary";
import { useBookGlossary } from "../../library/translation-glossary-store";
import { Icon } from "../app-ui/icons";
import styles from "./translation-panel.module.css";

/**
 * El glosario del libro en el panel «Traducir» (05.5): cómo se traduce siempre un nombre o un
 * término. Es de este libro y de este idioma de destino.
 */
export function GlossaryEditor({ documentId, target }: { documentId: string; target: string }) {
  const { entries, remove, save } = useBookGlossary(documentId, target);
  const [term, setTerm] = useState("");
  const [translation, setTranslation] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const language = languageName(target);

  function add(event: FormEvent) {
    event.preventDefault();
    const entry = { source: term, target: translation };
    if (save(entry)) {
      setMessage(`«${term.trim()}» se traducirá siempre como «${translation.trim()}».`);
      setTerm("");
      setTranslation("");
    } else {
      setMessage(
        entries.length >= glossaryLimits.entries
          ? `Caben ${glossaryLimits.entries} términos por libro e idioma.`
          : `Escribe el término y su traducción, de hasta ${glossaryLimits.term} caracteres.`,
      );
    }
  }

  return (
    <details className={styles.glossary}>
      <summary>
        <Icon name="book" size={16} />
        <span>Glosario de este libro</span>
        {entries.length ? <span className={styles.glossaryCount}>{entries.length}</span> : null}
      </summary>
      <p className={styles.hint}>
        Cómo se traduce siempre un nombre o un término al {language}. Si lo cambias, se vuelven a
        traducir solo los párrafos donde aparece.
      </p>
      {entries.length ? (
        <ul aria-label="Términos del glosario" className={styles.glossaryList}>
          {entries.map((entry) => (
            <li key={entry.source}>
              <span>{entry.source}</span>
              <span aria-hidden="true" className={styles.glossaryArrow}>
                →
              </span>
              <span lang={target}>{entry.target}</span>
              <button
                aria-label={`Quitar «${entry.source}» del glosario`}
                className={styles.glossaryRemove}
                onClick={() => {
                  remove(entry.source);
                  setMessage(`Quitado «${entry.source}».`);
                }}
                title="Quitar"
                type="button"
              >
                <Icon name="close" size={14} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <form className={styles.glossaryForm} onSubmit={add}>
        <Input
          aria-label="Término del libro"
          maxLength={glossaryLimits.term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Término"
          value={term}
        />
        <Input
          aria-label={`Su traducción al ${language}`}
          lang={target}
          maxLength={glossaryLimits.term}
          onChange={(event) => setTranslation(event.target.value)}
          placeholder="Traducción"
          value={translation}
        />
        <Button disabled={!term.trim() || !translation.trim()} size="sm" type="submit" variant="secondary">
          Añadir
        </Button>
      </form>
      {message ? (
        <p aria-live="polite" className={styles.status}>
          {message}
        </p>
      ) : null}
    </details>
  );
}

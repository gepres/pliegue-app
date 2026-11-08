"use client";

import { useEffect, useState, type FormEvent } from "react";

import { Button, Card, Input, Switch } from "@pliegue/ui";

import { budgetProviderNames } from "../../ai/ai-budget";
import { getSessionApiKey, useAiSessionSecrets } from "../../ai/ai-session-secret-store";
import { askModelOf, askProviderOf } from "../../ai/ai-settings";
import { useAiSettings } from "../../ai/ai-settings-store";
import { refineWithAi, tastesForAi, type AiRefinement } from "../../ai/recommend-with-ai";
import { coverUrl, tasteSubjects, type Recommendation, type TasteProfile } from "../../library/recommendations";
import { clearTaste, disableRecommendations, dismissRecommendation, loadRecommendations, saveTasteProfile, useTasteProfile, type RecommendationsResult } from "../../library/taste-store";
import { useLibraryDocuments } from "../../library/use-library-documents";
import { confirmAction } from "../app-ui/confirm-dialog";
import { Icon } from "../app-ui/icons";
import { showBookOffers } from "./book-offers";
import styles from "./for-you.module.css";

/**
 * «Para ti» (06.1): recomendaciones con su porqué, desde los gustos que la persona declara y,
 * si lo activa, desde su biblioteca. Cada libro trae «Dónde conseguirlo» (06.2).
 */
export function ForYou() {
  const profile = useTasteProfile();
  const [editing, setEditing] = useState(false);
  if (!profile.enabled || editing) {
    return <TasteForm onDone={() => setEditing(false)} profile={profile} />;
  }
  return <Recommendations onEdit={() => setEditing(true)} profile={profile} />;
}

/* ---- Los gustos --------------------------------------------------------------------------------------------- */

function TasteForm({ onDone, profile }: { onDone: () => void; profile: TasteProfile }) {
  const [subjects, setSubjects] = useState<string[]>(profile.subjects);
  const [authors, setAuthors] = useState<string[]>(profile.authors);
  const [authorDraft, setAuthorDraft] = useState("");
  const [useLibrary, setUseLibrary] = useState(profile.useLibrary);
  const empty = !subjects.length && !authors.length && !useLibrary;

  function addAuthor() {
    const name = authorDraft.replace(/\s+/g, " ").trim();
    if (name && !authors.includes(name) && authors.length < 12) setAuthors([...authors, name]);
    setAuthorDraft("");
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (empty) return;
    saveTasteProfile({ ...profile, authors, enabled: true, subjects, useLibrary });
    onDone();
  }

  return (
    <Card aria-labelledby="taste-title" as="section" className={styles.panel}>
      <div className={styles.intro}>
        <h2 id="taste-title">{profile.enabled ? "Tus gustos" : "Libros para ti"}</h2>
        <p>
          Dinos qué te gusta y te recomendamos libros, cada uno con el porqué. Se buscan en Open Library, el catálogo
          abierto: se le envían los temas y los autores que elijas, nunca tus libros. Todo se guarda solo en este equipo.
        </p>
      </div>
      <form className={styles.form} onSubmit={save}>
        <fieldset className={styles.subjects}>
          <legend>Temas que te interesan</legend>
          <div>
            {tasteSubjects.map((subject) => {
              const on = subjects.includes(subject.id);
              return (
                <button
                  aria-pressed={on}
                  className={styles.chip}
                  key={subject.id}
                  onClick={() => setSubjects(on ? subjects.filter((id) => id !== subject.id) : [...subjects, subject.id].slice(0, 12))}
                  type="button"
                >
                  {on ? <Icon name="check" size={14} /> : null}
                  {subject.label}
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className={styles.authors}>
          <label htmlFor="taste-author">Autores que te gustan</label>
          <div className={styles.authorRow}>
            <Input
              id="taste-author"
              onChange={(event) => setAuthorDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addAuthor();
                }
              }}
              placeholder="Por ejemplo, Isabel Allende"
              value={authorDraft}
            />
            <Button disabled={!authorDraft.trim()} onClick={addAuthor} size="sm" type="button" variant="secondary">
              Añadir
            </Button>
          </div>
          {authors.length ? (
            <ul aria-label="Autores elegidos" className={styles.authorList}>
              {authors.map((name) => (
                <li key={name}>
                  {name}
                  <button aria-label={`Quitar a ${name}`} onClick={() => setAuthors(authors.filter((item) => item !== name))} type="button">
                    <Icon name="close" size={14} />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <Switch
          checked={useLibrary}
          description="Los autores y géneros de las fichas de tus libros, y tus favoritos, afinan las recomendaciones. Nunca los confidenciales ni los personales, y no sale ningún título."
          label="Usar también mi biblioteca"
          onChange={(event) => setUseLibrary(event.target.checked)}
        />

        <div className={styles.actions}>
          <Button disabled={empty} type="submit">
            {profile.enabled ? "Guardar mis gustos" : "Ver recomendaciones"}
          </Button>
          {profile.enabled ? (
            <Button onClick={onDone} type="button" variant="quiet">
              Cancelar
            </Button>
          ) : null}
          {empty ? <span className={styles.hint}>Elige algún tema o autor, o usa tu biblioteca.</span> : null}
        </div>
      </form>
    </Card>
  );
}

/* ---- Las recomendaciones ------------------------------------------------------------------------------------------ */

function Recommendations({ onEdit, profile }: { onEdit: () => void; profile: TasteProfile }) {
  const library = useLibraryDocuments();
  const settings = useAiSettings();
  const secrets = useAiSessionSecrets();
  const [state, setState] = useState<{ key: string; result: RecommendationsResult } | null>(null);
  const [ai, setAi] = useState<{ error: string | null; refinement: AiRefinement | null; running: boolean }>({ error: null, refinement: null, running: false });
  const documents = library.allDocuments;
  const key = `${profile.updatedAt}|${documents.length}|${library.loading}`;

  useEffect(() => {
    if (library.loading) return;
    let active = true;
    void loadRecommendations(profile, documents).then((result) => {
      if (active) setState({ key, result });
    });
    return () => {
      active = false;
    };
  }, [documents, key, library.loading, profile]);

  const result = state?.key === key ? state.result : null;
  const aiItems = (ai.refinement?.items ?? []).filter((item) => !profile.dismissed.includes(item.key));
  const items = [...aiItems, ...(result?.items ?? []).filter((item) => !aiItems.some((suggested) => suggested.key === item.key))];
  const provider = askProviderOf(settings);
  const providerName = budgetProviderNames[provider] ?? provider;
  const aiReady = provider === "ollama" || Boolean(secrets[provider]);

  async function refine() {
    const tastes = tastesForAi(profile, documents);
    const confirmed = await confirmAction({
      confirmLabel: "Afinar",
      description: `Se envían a ${providerName} (${askModelOf(settings)}) tus gustos para que proponga libros. Solo se enseñan los que existen en Open Library.`,
      details: [
        tastes.subjects.length ? `Temas: ${tastes.subjects.join(", ")}` : "Sin temas",
        tastes.authors.length ? `Autores: ${tastes.authors.join(", ")}` : "Sin autores",
      ],
      icon: "sparkles",
      note: "No se envía ningún título de tu biblioteca. Cuenta para el presupuesto de IA.",
      title: "¿Afinar con IA?",
    });
    if (!confirmed) return;
    setAi({ error: null, refinement: null, running: true });
    try {
      setAi({ error: null, refinement: await refineWithAi(profile, documents, settings, getSessionApiKey(provider)), running: false });
    } catch (error) {
      setAi({ error: error instanceof Error ? error.message : "La IA no pudo recomendar.", refinement: null, running: false });
    }
  }

  async function forget() {
    const confirmed = await confirmAction({
      confirmLabel: "Borrar mis gustos",
      description: "Se borran tus temas, tus autores, los libros que descartaste y lo recomendado. Puedes volver a empezar cuando quieras.",
      icon: "trash",
      title: "¿Borrar tus gustos?",
      tone: "danger",
    });
    if (confirmed) clearTaste();
  }

  async function disable() {
    const confirmed = await confirmAction({
      confirmLabel: "Desactivar",
      description: "Pliegue deja de recomendarte libros y olvida lo recomendado. Tus gustos se quedan por si vuelves; bórralos si quieres.",
      icon: "info",
      title: "¿Desactivar las recomendaciones?",
    });
    if (confirmed) disableRecommendations();
  }

  return (
    <Card aria-labelledby="recommendations-title" as="section" className={styles.panel}>
      <div className={styles.head}>
        <div className={styles.intro}>
          <h2 id="recommendations-title">Libros para ti</h2>
          <p>
            Con {profile.useLibrary ? "tus gustos y tu biblioteca" : "solo los gustos que elegiste"}. Cada libro dice por qué
            se recomienda; lo que ya tienes no aparece.
          </p>
        </div>
        <div className={styles.actions}>
          <Button disabled={!aiReady || ai.running} onClick={() => void refine()} size="sm" variant="secondary">
            {ai.running ? "Afinando…" : "Afinar con IA"}
          </Button>
          <Button onClick={onEdit} size="sm" variant="quiet">
            Editar mis gustos
          </Button>
        </div>
      </div>

      {ai.error ? (
        <p className={styles.problem} role="alert">
          {ai.error}
        </p>
      ) : ai.refinement ? (
        <p className={styles.note} role="status">
          Tu IA propuso {ai.refinement.proposed} {ai.refinement.proposed === 1 ? "libro" : "libros"}; {ai.refinement.verified}{" "}
          {ai.refinement.verified === 1 ? "existe" : "existen"} en Open Library y {ai.refinement.verified === 1 ? "sale" : "salen"} primero.
        </p>
      ) : !aiReady ? (
        <p className={styles.note}>Para afinar con IA, pon la clave de {providerName} en Ajustes → IA.</p>
      ) : null}

      {!result ? (
        <p className={styles.note} role="status">
          Buscando libros para ti…
        </p>
      ) : (
        <>
          {result.failed ? (
            <p className={styles.problem} role="alert">
              Open Library no respondió a {result.failed} de {result.searched} búsquedas. Revisa la conexión y vuelve a intentarlo.
            </p>
          ) : null}
          {items.length ? (
            <ol className={styles.grid}>
              {items.map((item) => (
                <RecommendationCard item={item} key={item.key} />
              ))}
            </ol>
          ) : (
            <p className={styles.note}>No encontramos libros con estos gustos. Prueba con otros temas o autores.</p>
          )}
        </>
      )}

      <div className={styles.privacy}>
        <p>
          Se buscan en Open Library {profile.useLibrary ? "los temas y autores que elegiste y los de tu biblioteca" : "los temas y autores que elegiste"}
          ; nunca tus títulos ni tus archivos. Lo recomendado se recuerda un día en este equipo. Ningún enlace es de afiliado.
        </p>
        <div className={styles.actions}>
          <Button onClick={() => void disable()} size="sm" variant="quiet">
            Desactivar recomendaciones
          </Button>
          <Button onClick={() => void forget()} size="sm" variant="quiet">
            Borrar mis gustos
          </Button>
        </div>
      </div>
    </Card>
  );
}

function RecommendationCard({ item }: { item: Recommendation }) {
  return (
    <li className={styles.card} data-recommendation={item.key}>
      {item.coverId ? (
        // Portada de Open Library: la decoración, el título va al lado.
        // eslint-disable-next-line @next/next/no-img-element
        <img alt="" className={styles.cover} height={150} loading="lazy" src={coverUrl(item.coverId)} width={100} />
      ) : (
        <div aria-hidden="true" className={styles.cover} />
      )}
      <div className={styles.body}>
        <h3>{item.title}</h3>
        <p className={styles.meta}>{[item.author, item.year].filter(Boolean).join(" · ")}</p>
        <ul aria-label="Por qué te lo recomendamos" className={styles.reasons}>
          {item.reasons.map((reason) => (
            <li data-kind={reason.kind} key={reason.text}>
              {reason.text}
            </li>
          ))}
        </ul>
        <div className={styles.cardActions}>
          <Button
            onClick={() =>
              showBookOffers({ authors: item.author ? [item.author] : [], isbn: item.isbn, label: item.author ? `${item.title}, de ${item.author}` : item.title, title: item.title })
            }
            size="sm"
            variant="secondary"
          >
            Dónde conseguirlo
          </Button>
          <Button onClick={() => dismissRecommendation(item.key)} size="sm" variant="quiet">
            No me interesa
          </Button>
          <a href={`https://openlibrary.org${item.key}`} rel="noopener noreferrer" target="_blank">
            Ver en Open Library
          </a>
        </div>
      </div>
    </li>
  );
}

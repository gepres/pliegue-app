"use client";

import Link from "next/link";

import { Card, Tag, buttonClassName } from "@pliegue/ui";

import { coverUrl, subjectById } from "../../library/recommendations";
import { useCachedRecommendations, useTasteProfile } from "../../library/taste-store";
import { Icon } from "../app-ui/icons";
import styles from "./for-you.module.css";

/**
 * «Libros para ti» en Inicio (06.1): la puerta a las recomendaciones, bien a la vista. Sin gustos,
 * invita a elegirlos; con recomendaciones ya hechas, enseña las primeras portadas. No pregunta
 * nada a nadie: lo recomendado sale de lo guardado en este equipo.
 */
export function ForYouTeaser() {
  const profile = useTasteProfile();
  const items = useCachedRecommendations(profile).slice(0, 4);
  const tastes = [...profile.subjects.map((id) => subjectById(id)?.label).filter(Boolean), ...profile.authors].slice(0, 4);

  return (
    <Card aria-labelledby="para-ti-inicio" as="section" className={styles.teaser}>
      <div className={styles.teaserText}>
        <Tag>
          <Icon name="compass" size={14} /> Para ti
        </Tag>
        <h2 id="para-ti-inicio">Libros para ti</h2>
        {profile.enabled ? (
          <p>
            {tastes.length ? `Según lo que te gusta: ${tastes.join(", ")}. ` : ""}
            Cada uno con su porqué y dónde conseguirlo.
          </p>
        ) : (
          <p>
            Dinos qué temas y autores te gustan y te proponemos libros, cada uno con su porqué y dónde conseguirlo.
            Nada de tu biblioteca sale sin tu permiso.
          </p>
        )}
        <Link className={buttonClassName()} href="/app/para-ti">
          {profile.enabled ? "Ver recomendaciones" : "Elegir mis gustos"}
        </Link>
      </div>
      {items.length ? (
        <ul aria-label="Algunas recomendaciones" className={styles.teaserCovers}>
          {items.map((item) => (
            <li key={item.key}>
              <Link href="/app/para-ti" title={item.author ? `${item.title}, de ${item.author}` : item.title}>
                {item.coverId ? (
                  // eslint-disable-next-line @next/next/no-img-element -- portada de Open Library, ya vista en «Para ti»
                  <img alt="" className={styles.teaserCover} decoding="async" loading="lazy" src={coverUrl(item.coverId)} />
                ) : (
                  <span aria-hidden="true" className={styles.teaserCover} data-generated="true">
                    {item.title}
                  </span>
                )}
                <span className={styles.teaserTitle}>{item.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div aria-hidden="true" className={styles.teaserArt}>
          <Icon name="compass" size={72} />
        </div>
      )}
    </Card>
  );
}

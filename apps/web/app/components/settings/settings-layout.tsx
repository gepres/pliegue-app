"use client";

import { useEffect, useState, type ReactNode } from "react";

import { cx } from "@pliegue/ui";

import { Icon, type IconName } from "../app-ui/icons";
import styles from "./settings.module.css";

export interface SettingsSection {
  content: ReactNode;
  description: string;
  icon: IconName;
  id: string;
  label: string;
}

/**
 * Ajustes como en una app de sistema: lista de categorías a la izquierda y el detalle a la
 * derecha; en el teléfono, la lista ocupa la pantalla y cada categoría se abre encima con
 * su botón de volver.
 *
 * La categoría abierta vive en el fragmento de la URL (`#ia`, `#lectura`): así se puede
 * enlazar desde el lector o la Biblioteca y el botón «atrás» del navegador o del sistema
 * vuelve a la lista. Todas las categorías siguen montadas y solo se ocultan, para que un
 * formulario a medias no se pierda al consultar otra.
 */
export function SettingsLayout({ sections }: { sections: readonly SettingsSection[] }) {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    function sync() {
      const id = window.location.hash.replace("#", "");
      setActive(sections.some((section) => section.id === id) ? id : null);
    }
    const frame = window.requestAnimationFrame(sync);
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, [sections]);

  function open(id: string) {
    if (window.location.hash !== `#${id}`) window.history.pushState(null, "", `#${id}`);
    setActive(id);
    // En el teléfono el detalle sustituye a la lista: empieza arriba, no donde se tocó.
    window.scrollTo({ top: 0 });
  }

  function back() {
    if (window.location.hash) window.history.back();
    setActive(null);
  }

  // En escritorio siempre hay una categoría a la vista; en móvil, sin fragmento, la lista.
  const shown = active ?? sections[0]?.id ?? null;

  return (
    <div className={styles.layout} data-detail={active ? "open" : "closed"}>
      <header className={styles.header}>
        <h1>Ajustes</h1>
        <p>Apariencia, privacidad y proveedores, sin perder el control de tus datos.</p>
      </header>

      <nav aria-label="Categorías de ajustes" className={styles.nav}>
        <ul>
          {sections.map((section) => (
            <li key={section.id}>
              <a
                aria-current={shown === section.id ? "page" : undefined}
                className={styles.navItem}
                href={`#${section.id}`}
                onClick={(event) => {
                  event.preventDefault();
                  open(section.id);
                }}
              >
                <span className={styles.navIcon}>
                  <Icon name={section.icon} size={18} />
                </span>
                <span className={styles.navText}>
                  <strong>{section.label}</strong>
                  <small>{section.description}</small>
                </span>
                <Icon className={styles.navChevron} name="chevronRight" size={18} />
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className={styles.detail}>
        {sections.map((section) => (
          <section
            aria-labelledby={`settings-${section.id}-title`}
            className={cx(styles.panel)}
            hidden={shown !== section.id}
            id={`ajustes-${section.id}`}
            key={section.id}
          >
            <div className={styles.panelHeader}>
              <button className={styles.back} onClick={back} type="button">
                <Icon name="back" size={18} />
                Ajustes
              </button>
              <h2 id={`settings-${section.id}-title`}>{section.label}</h2>
              <p>{section.description}</p>
            </div>
            {section.content}
          </section>
        ))}
      </div>
    </div>
  );
}

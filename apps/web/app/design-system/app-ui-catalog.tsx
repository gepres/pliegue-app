"use client";

import { useState } from "react";

import { Button, Card } from "@pliegue/ui";

import { Disclosure, IconButton, Segmented, Toast } from "../components/app-ui/controls";
import { Icon, iconNames } from "../components/app-ui/icons";
import { MenuItem, MenuSeparator, Popover, Sheet } from "../components/app-ui/overlays";
import pageStyles from "./page.module.css";
import styles from "./app-ui-catalog.module.css";

/**
 * Los controles de `components/app-ui` en el catálogo (02.2b). Viven en la app y no en
 * `@pliegue/ui` —ver docs/design-system.md, «Controles de la app»—, pero se enseñan aquí con sus
 * variantes y estados, como el resto del sistema.
 */
export function AppUiCatalog() {
  const [view, setView] = useState<"grid" | "list">("grid");
  const [size, setSize] = useState<"s" | "m" | "l">("m");
  const [sheet, setSheet] = useState<"modal" | "panel" | null>(null);
  const [toast, setToast] = useState<{ nonce: number; text: string } | null>(null);
  const [chosen, setChosen] = useState("Nada elegido todavía.");

  return (
    <div className={pageStyles.componentStack}>
      <Card className={pageStyles.componentDemo}>
        <div>
          <h3>IconButton</h3>
          <p>
            Un icono sin palabras lleva siempre su nombre accesible, que también sale como rótulo al
            pasar por encima, con el atajo si lo tiene. Tres tonos y dos tamaños; un número encima
            cuando cuenta algo.
          </p>
        </div>
        <div className={styles.row}>
          <IconButton icon="search" label="Buscar" />
          <IconButton icon="star" label="Favorito" tone="active" />
          <IconButton icon="plus" label="Añadir" tone="filled" />
          <IconButton icon="filter" label="Filtros" size="sm" />
          <IconButton badge={3} icon="note" label="Notas" />
          <IconButton icon="expand" label="Pantalla completa" shortcut="F" />
          <IconButton disabled icon="trash" label="Borrar (desactivado)" />
        </div>
      </Card>

      <Card className={pageStyles.componentDemo}>
        <div>
          <h3>Segmented</h3>
          <p>Elegir una entre pocas opciones que se ven a la vez: vista, tamaño, modo de lectura.</p>
        </div>
        <div className={styles.row}>
          <Segmented<"grid" | "list">
            label="Vista"
            onChange={setView}
            options={[
              { icon: "grid", label: "Cuadrícula", value: "grid" },
              { icon: "list", label: "Lista", value: "list" },
            ]}
            value={view}
          />
          <Segmented<"s" | "m" | "l">
            label="Tamaño del texto"
            onChange={setSize}
            options={[
              { label: "Pequeño", value: "s" },
              { label: "Normal", value: "m" },
              { label: "Grande", value: "l" },
            ]}
            size="sm"
            value={size}
          />
        </div>
      </Card>

      <Card className={pageStyles.componentDemo}>
        <div>
          <h3>Disclosure</h3>
          <p>Lo que se consulta de vez en cuando, plegado: no ocupa la pantalla hasta que se pide.</p>
        </div>
        <div className={styles.column}>
          <Disclosure icon="info" summary="Plegado: se abre al pulsarlo" title="Referencia de campos">
            <p className={styles.note}>Contenido de ejemplo dentro del desplegable.</p>
          </Disclosure>
          <Disclosure defaultOpen meta={<code>3</code>} summary="Abierto de entrada, con un dato a la derecha" title="Glosario de este libro">
            <p className={styles.note}>Contenido de ejemplo dentro del desplegable.</p>
          </Disclosure>
        </div>
      </Card>

      <Card className={pageStyles.componentDemo}>
        <div>
          <h3>Popover y MenuItem</h3>
          <p>
            El menú de un libro y los paneles pequeños. Se abren hacia donde quepan y, en el móvil,
            como hoja desde abajo con velo. Escape lo cierra y devuelve el foco al botón.
          </p>
        </div>
        <div className={styles.row}>
          <Popover
            kind="menu"
            title="Acciones del libro"
            trigger={(props) => (
              <button {...props} className={styles.trigger} type="button">
                <Icon name="more" size={18} /> Menú
              </button>
            )}
          >
            {(close) => (
              <>
                <MenuItem
                  icon="book"
                  label="Abrir en el lector"
                  onSelect={() => {
                    setChosen("Abrir en el lector");
                    close();
                  }}
                />
                <MenuItem
                  description="Con su descripción debajo"
                  icon="star"
                  label="Marcar como favorito"
                  onSelect={() => {
                    setChosen("Marcar como favorito");
                    close();
                  }}
                />
                <MenuItem disabled icon="share" label="Compartir (desactivado)" onSelect={() => undefined} />
                <MenuSeparator />
                <MenuItem
                  danger
                  icon="trash"
                  label="Desvincular"
                  onSelect={() => {
                    setChosen("Desvincular");
                    close();
                  }}
                />
              </>
            )}
          </Popover>
          <Popover
            title="Filtros"
            trigger={(props) => (
              <button {...props} className={styles.trigger} type="button">
                <Icon name="filter" size={18} /> Panel
              </button>
            )}
            width={320}
          >
            <p className={styles.note}>Un panel pequeño: filtros, ajustes rápidos o una ayuda.</p>
          </Popover>
          <span className={styles.note} role="status">
            {chosen}
          </span>
        </div>
      </Card>

      <Card className={pageStyles.componentDemo}>
        <div>
          <h3>Sheet</h3>
          <p>
            Panel que entra por un lado —desde abajo en el móvil—. Modal, con velo, cuando se va a
            hacer algo y volver; sin velo cuando se lee con él abierto, como el panel del lector.
          </p>
        </div>
        <div className={styles.row}>
          <Button onClick={() => setSheet("modal")} size="sm" variant="secondary">
            Abrir hoja modal
          </Button>
          <Button onClick={() => setSheet("panel")} size="sm" variant="quiet">
            Abrir panel sin velo
          </Button>
        </div>
        <Sheet
          description="Con velo detrás: el resto de la página espera."
          footer={
            <Button onClick={() => setSheet(null)} size="sm">
              Hecho
            </Button>
          }
          onClose={() => setSheet(null)}
          open={sheet === "modal"}
          title="Hoja modal"
        >
          <p className={styles.note}>Contenido de ejemplo. Escape o «Cerrar» la cierran.</p>
        </Sheet>
        <Sheet
          description="Sin velo en escritorio: se puede seguir usando la página."
          modal={false}
          onClose={() => setSheet(null)}
          open={sheet === "panel"}
          title="Panel sin velo"
        >
          <p className={styles.note}>Contenido de ejemplo.</p>
        </Sheet>
      </Card>

      <Card className={pageStyles.componentDemo}>
        <div>
          <h3>Toast</h3>
          <p>Lo que acaba de pasar, abajo y un momento: «Copiado», «3 importados». No pide nada.</p>
        </div>
        <div className={styles.row}>
          <Button onClick={() => setToast({ nonce: Date.now(), text: "3 importados." })} size="sm" variant="secondary">
            Enseñar un aviso
          </Button>
        </div>
        <Toast message={toast?.text ?? null} nonce={toast?.nonce ?? 0} />
      </Card>

      {/* La rejilla va debajo del texto y a todo lo ancho: al lado, la tarjeta en fila la
          encogía a una sola columna. */}
      <Card className={`${pageStyles.componentDemo} ${styles.iconsCard}`}>
        <div>
          <h3>Iconos</h3>
          <p>
            Trazo de 1,75 px en una rejilla de 24, del color del texto. Son los de la app: lo que no
            está aquí se dibuja con la misma regla antes de usarse.
          </p>
        </div>
        <ul aria-label="Iconos de la app" className={styles.icons}>
          {iconNames.map((name) => (
            <li key={name}>
              <Icon name={name} size={22} />
              <code>{name}</code>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

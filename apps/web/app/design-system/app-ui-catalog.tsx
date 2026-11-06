"use client";

import { useState } from "react";

import { Button, Card, Tag } from "@pliegue/ui";

import { ConfirmDialogHost, confirmAction, confirmWithChoice } from "../components/app-ui/confirm-dialog";
import { Disclosure, IconButton, Segmented, Toast } from "../components/app-ui/controls";
import { Icon, iconNames } from "../components/app-ui/icons";
import { NextStepHost, suggestNextStep } from "../components/app-ui/next-step-dialog";
import { MenuItem, MenuSeparator, Popover, Sheet } from "../components/app-ui/overlays";
import { Skeleton, SkeletonGroup, SkeletonPage, SkeletonText } from "../components/app-ui/skeleton";
import { DocumentCard, DocumentCardSkeletons, MetricCard, PageHeader } from "../components/workspace-page";
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
  const [loading, setLoading] = useState(true);
  const [answer, setAnswer] = useState("Sin preguntar todavía.");

  async function ask(kind: "choice" | "danger" | "default") {
    if (kind === "choice") {
      const result = await confirmWithChoice({
        choice: { description: "Empieza apagado: lo que es opcional no se borra sin elegirlo.", label: "Borrar también sus traducciones" },
        confirmLabel: "Desvincular",
        description: "El archivo original no se toca; se olvidan su índice y su ficha.",
        title: "¿Desvincular «Ficciones»?",
      });
      setAnswer(result.confirmed ? `Desvinculado${result.chosen ? ", con sus traducciones" : ""}.` : "Cancelado.");
      return;
    }
    const confirmed = await confirmAction(
      kind === "danger"
        ? {
            confirmLabel: "Borrar todo",
            description: "Se borra lo guardado en este navegador. No se puede deshacer.",
            details: ["Biblioteca y fichas", "Notas, resaltados y progreso", "Traducciones guardadas"],
            icon: "trash",
            note: "Tus archivos originales no se tocan.",
            title: "¿Borrar todo en este navegador?",
            tone: "danger",
          }
        : {
            confirmLabel: "Juntar y sincronizar",
            description: "Lo de este equipo se junta con lo de tu cuenta. Nada se borra.",
            icon: "cloud",
            title: "¿Juntar este equipo con tu cuenta?",
          },
    );
    setAnswer(confirmed ? "Confirmado." : "Cancelado.");
  }

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

      <Card className={`${pageStyles.componentDemo} ${styles.stackedCard}`}>
        <div>
          <h3>Skeleton</h3>
          <p>
            La forma de lo que va a llegar mientras llega: sin «Cargando…» ni ceros que luego saltan.
            Aparece tras 140 ms (si los datos llegan antes, ni se ve), late suave y se queda quieto con
            «reducir movimiento». El grupo se anuncia al lector de pantalla; el dibujo va oculto.
          </p>
        </div>
        <div className={styles.column}>
          <div className={styles.row}>
            <Button onClick={() => setLoading((value) => !value)} size="sm" variant="secondary">
              {loading ? "Ver con contenido" : "Ver cargando"}
            </Button>
          </div>
          <div className={styles.skeletonGrid}>
            <MetricCard detail="2 archivos · 1 en carpetas · 0 copias" label="Documentos" loading={loading} value="3" />
            <div className={styles.skeletonSample}>
              <small>Líneas de texto</small>
              {loading ? (
                <SkeletonGroup label="Cargando el resumen">
                  <SkeletonText lines={3} />
                </SkeletonGroup>
              ) : (
                <p className={styles.note}>Un resumen de tres líneas, ya cargado, en el mismo sitio que ocupaba el esqueleto.</p>
              )}
            </div>
            <div className={styles.skeletonSample}>
              <small>Fila con avatar y botón</small>
              {loading ? (
                <SkeletonGroup className={styles.skeletonRow} label="Comprobando la sesión">
                  <Skeleton shape="circle" />
                  <SkeletonText lastWidth="50%" lines={2} />
                  <Skeleton height="2rem" radius={999} width="6rem" />
                </SkeletonGroup>
              ) : (
                <div className={styles.skeletonRow}>
                  <span className={styles.avatar}>L</span>
                  <p className={styles.note}>lectora@ejemplo.org · Con Google</p>
                  <Button size="sm" variant="quiet">
                    Cerrar sesión
                  </Button>
                </div>
              )}
            </div>
            <div className={styles.skeletonSample}>
              <small>Dentro de una frase</small>
              <p className={styles.note}>
                Faltan {loading ? <Skeleton label="Contando…" shape="inline" width="4ch" /> : "12"} libros por catalogar.
              </p>
            </div>
          </div>
          <div className={styles.skeletonSample}>
            <small>Página de un documento (SkeletonPage)</small>
            <div className={styles.pagePreview}>{loading ? <SkeletonPage /> : <p className={styles.note}>El documento, ya abierto.</p>}</div>
          </div>
        </div>
      </Card>

      <Card className={pageStyles.componentDemo}>
        <div>
          <h3>Diálogo de confirmación</h3>
          <p>
            Lo que no se puede deshacer o sale del equipo se pregunta antes: qué pasa en una frase, lo
            que se pierde renglón a renglón y, si hace falta, una opción que empieza apagada.
          </p>
        </div>
        <div className={styles.column}>
          <div className={styles.row}>
            <Button onClick={() => void ask("default")} size="sm" variant="secondary">
              Confirmar
            </Button>
            <Button onClick={() => void ask("danger")} size="sm" variant="danger">
              Borrar (peligro)
            </Button>
            <Button onClick={() => void ask("choice")} size="sm" variant="quiet">
              Con una opción
            </Button>
          </div>
          <span className={styles.note} role="status">
            {answer}
          </span>
        </div>
      </Card>

      <Card className={pageStyles.componentDemo}>
        <div>
          <h3>Siguiente paso</h3>
          <p>
            Tras terminar algo (importar, catalogar), propone lo que suele venir después. Lo que aún no
            se puede hacer se enseña con su motivo, en vez de esconderlo. Si la persona apagó las
            sugerencias en Ajustes, no aparece.
          </p>
        </div>
        <div className={styles.row}>
          <Button
            onClick={() =>
              suggestNextStep({
                actions: [
                  { description: "Para leer o traducir lo que acabas de añadir.", href: "/design-system#app-ui-title", icon: "book", label: "Abrir en el lector", primary: true },
                  { blockedReason: "Primero elige un proveedor en Ajustes → IA.", icon: "sparkles", label: "Catalogar con IA" },
                ],
                description: "3 libros importados en este navegador.",
                icon: "check",
                title: "Listo. ¿Y ahora?",
              })
            }
            size="sm"
            variant="secondary"
          >
            Enseñar la sugerencia
          </Button>
        </div>
      </Card>

      <Card className={`${pageStyles.componentDemo} ${styles.stackedCard}`}>
        <div>
          <h3>Cabecera, cifras y tarjetas de documento</h3>
          <p>
            Las piezas de las pantallas de la app (workspace-page): la cabecera con su etiqueta y sus
            acciones, la cifra con su detalle y la tarjeta de un documento, también en su esqueleto.
          </p>
        </div>
        <div className={styles.column}>
          <div className={styles.headerSample}>
            <PageHeader
              actions={
                <Button size="sm" variant="secondary">
                  Añadir documentos
                </Button>
              }
              compact
              description="Vincula archivos o carpetas; Pliegue conserva referencias e índices derivados."
              eyebrow="Área local · Ejemplo"
              title="Tu biblioteca de trabajo"
            />
          </div>
          <div className={styles.documentGrid}>
            <DocumentCard eyebrow="EPUB · Local" title="Ficciones">
              <p>Jorge Luis Borges · 1944</p>
              <Tag>Disponible</Tag>
            </DocumentCard>
            <DocumentCardSkeletons className={styles.documentSkeletons} count={1} label="Cargando un documento" />
          </div>
        </div>
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
      {/* /design-system está fuera del shell de la app, que es quien monta estos dos. */}
      <ConfirmDialogHost />
      <NextStepHost />
    </div>
  );
}

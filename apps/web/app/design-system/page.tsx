import type { CSSProperties } from "react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { primitiveColors, semanticTokens, spacingTokens } from "@pliegue/tokens";
import { Button, Card, Field, Input, Select, Tag, buttonClassName } from "@pliegue/ui";

import { ThemeToggle } from "../components/theme-toggle";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Sistema visual",
};

function tokenStyle(variable: string): CSSProperties {
  return { backgroundColor: `var(${variable})` };
}

function StyleFrame({ theme }: { theme: "dark" | "light" }) {
  const suffix = theme === "light" ? "light" : "dark";

  return (
    <article className={styles.styleFrame} data-theme={theme}>
      <div className={styles.frameChrome}>
        <span>STYLE FRAME · {theme.toUpperCase()}</span>
        <span>RESPONSIVE · 1440 / 390</span>
      </div>
      <div className={styles.frameShell}>
        <div className={styles.frameRail}>
          <Image alt="" height={34} src="/brand/pliegue-mark.svg" width={34} />
          <div className={styles.frameRailItems} aria-hidden="true">
            <span className={styles.frameRailActive}>IN</span>
            <span>BI</span>
            <span>LE</span>
            <span>IA</span>
          </div>
          <small>LOCAL</small>
        </div>
        <div className={styles.frameContent}>
          <Tag>Área unificada</Tag>
          <div className={styles.frameHeadline}>
            <div>
              <h3>Una biblioteca viva</h3>
              <p>Lee, organiza y conecta documentos sin perder su procedencia.</p>
            </div>
            <Link
              className={buttonClassName({ size: "sm", variant: "secondary" })}
              href="/app"
            >
              Abrir Pliegue
            </Link>
          </div>
          <div className={styles.frameCards}>
            <Card>
              <span>DOCUMENTOS</span>
              <strong>128</strong>
              <small>Drive + local</small>
            </Card>
            <Card>
              <span>LECTURA</span>
              <strong>38 %</strong>
              <small>Disponible offline</small>
            </Card>
          </div>
          <div className={styles.frameControls}>
            <Field label="Buscar" labelFor={`frame-search-${suffix}`}>
              <Input id={`frame-search-${suffix}`} placeholder="Título o concepto…" />
            </Field>
            <Button>Continuar leyendo</Button>
          </div>
        </div>
      </div>
    </article>
  );
}

function ReaderPatternFrame() {
  return (
    <article className={styles.readerFrame}>
      <div className={styles.readerFrameChrome}>
        <span>PRODUCT FRAME · LECTOR LOCAL</span>
        <span>TXT · EPUB · OFFICE · PDF</span>
      </div>
      <div className={styles.readerFrameHeader}>
        <div>
          <Tag>DOCX · Local-only</Tag>
          <h3>Informe de hallazgos</h3>
          <p>Documento estructurado · Guardado en este dispositivo</p>
        </div>
        <Link
          className={buttonClassName({ size: "sm", variant: "secondary" })}
          href="/app/lector"
        >
          Ver lector
        </Link>
      </div>
      <div className={styles.readerFrameBody}>
        <div className={styles.readerFramePaper}>
          <div>
            <span>WORD · EXTRACCIÓN LOCAL</span>
            <span>3 SECCIONES</span>
          </div>
          <h4>Una observación conserva su estructura</h4>
          <p>
            El lector recupera títulos, párrafos y listas sin subir el archivo ni perder su
            procedencia.
          </p>
        </div>
        <Card className={styles.readerFrameAside}>
          <Tag>Archivo estructurado</Tag>
          <strong>Sobre este archivo</strong>
          <dl>
            <div>
              <dt>Formato</dt>
              <dd>Word</dd>
            </div>
            <div>
              <dt>Origen</dt>
              <dd>IndexedDB local</dd>
            </div>
          </dl>
        </Card>
      </div>
    </article>
  );
}

export default function DesignSystemPage() {
  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div>
          <Tag>Foundations · tokens · v0.1</Tag>
          <h1>Sistema visual editorial cálido</h1>
          <p>
            Variables trazables a Figma y componentes compartidos para construir la
            interfaz sin duplicar estilos.
          </p>
        </div>
        <div className={styles.headerActions}>
          <ThemeToggle />
          <Link href="/">Volver al inicio</Link>
        </div>
      </header>

      <section aria-labelledby="frames-title" className={styles.section}>
        <div className={styles.sectionHeader}>
          <span>Style frames</span>
          <h2 id="frames-title">El sistema aplicado, no solo listado</h2>
          <p>
            Marcos de referencia para revisar jerarquía, densidad, contraste y respuesta
            antes de construir una pantalla completa.
          </p>
        </div>
        <div className={styles.frameGrid}>
          <StyleFrame theme="light" />
          <StyleFrame theme="dark" />
        </div>
      </section>

      <section aria-labelledby="color-title" className={styles.section}>
        <div className={styles.sectionHeader}>
          <span>Color</span>
          <h2 id="color-title">Primitivos de marca</h2>
        </div>
        <div className={styles.swatchGrid}>
          {primitiveColors.map((token) => (
            <Card className={styles.swatch} key={token.variable}>
              <span
                aria-hidden="true"
                className={styles.swatchColor}
                style={tokenStyle(token.variable)}
              />
              <strong>{token.name}</strong>
              <code>{token.variable}</code>
              <small>{token.value}</small>
            </Card>
          ))}
        </div>
      </section>

      <section aria-labelledby="semantic-title" className={styles.section}>
        <div className={styles.sectionHeader}>
          <span>Temas</span>
          <h2 id="semantic-title">Contrato semántico</h2>
        </div>
        <div className={styles.semanticFrames}>
          {(["light", "dark"] as const).map((theme) => (
            <div className={styles.semanticFrame} data-theme={theme} key={theme}>
              <div className={styles.frameChrome}>
                <span>SEMÁNTICOS · {theme.toUpperCase()}</span>
                <span>MISMO CONTRATO</span>
              </div>
              <div className={styles.semanticGrid}>
                {semanticTokens.map((token) => (
                  <Card key={token} tone="subtle">
                    <span
                      aria-hidden="true"
                      className={styles.semanticColor}
                      style={tokenStyle(`--pliegue-color-${token.replaceAll("/", "-")}`)}
                    />
                    <code>color/{token}</code>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="type-title" className={styles.section}>
        <div className={styles.sectionHeader}>
          <span>Tipografía</span>
          <h2 id="type-title">Lectura e interfaz</h2>
        </div>
        <div className={styles.typeGrid}>
          <Card>
            <small>Display/Brand · Cormorant Garamond · 40px</small>
            <p className={styles.brandSample}>Pliegue</p>
          </Card>
          <Card>
            <small>Reading/Body · Source Serif 4 · 18px</small>
            <p className={styles.readingSample}>
              Las fuentes permanecen intactas mientras lees, anotas y conectas ideas.
            </p>
          </Card>
          <Card>
            <small>UI/Body · Inter · 15px</small>
            <p className={styles.uiSample}>
              Organiza Drive y archivos locales en un mismo espacio.
            </p>
          </Card>
          <Card>
            <small>Data/Meta · IBM Plex Mono · 11px</small>
            <p className={styles.dataSample}>PDF · 471 PÁGINAS</p>
          </Card>
        </div>
      </section>

      <section aria-labelledby="spacing-title" className={styles.section}>
        <div className={styles.sectionHeader}>
          <span>Layout</span>
          <h2 id="spacing-title">Espaciado</h2>
        </div>
        <Card className={styles.spacingList}>
          {spacingTokens.map((token) => (
            <div className={styles.spacingRow} key={token.name}>
              <span
                aria-hidden="true"
                className={styles.spacingBar}
                style={{ width: token.value }}
              />
              <code>
                spacing/{token.name} · {token.value} · --pliegue-spacing-{token.name}
              </code>
            </div>
          ))}
        </Card>
      </section>

      <section aria-labelledby="component-title" className={styles.section}>
        <div className={styles.sectionHeader}>
          <span>Componentes</span>
          <h2 id="component-title">Estados reutilizables</h2>
        </div>
        <div className={styles.componentStack}>
        <Card className={styles.componentDemo}>
          <div>
            <h3>Button</h3>
            <p>Acciones con objetivo táctil, foco visible y variantes semánticas.</p>
          </div>
          <div className={styles.componentRow}>
            <Button>Primario</Button>
            <Button variant="secondary">Secundario</Button>
            <Button variant="quiet">Discreto</Button>
            <Button disabled>Desactivado</Button>
          </div>
        </Card>
        <Card className={styles.componentDemo}>
          <div>
            <h3>Field + Select</h3>
            <p>
              Etiqueta, ayuda y control nativo asociados. Conserva 44 px de objetivo
              táctil, foco visible y contraste semántico en Light/Dark.
            </p>
          </div>
          <div className={styles.fieldDemo}>
            <Field label="Buscar" labelFor="catalog-search">
              <Input id="catalog-search" placeholder="Título, autor o concepto…" type="search" />
            </Field>
            <Field
              description="Las pantallas deben mantener la etiqueta visible."
              label="Perfil de lectura"
              labelFor="catalog-reading-profile"
            >
              <Select defaultValue="balanced" id="catalog-reading-profile">
                <option value="balanced">Equilibrado</option>
                <option value="focus">Concentración</option>
                <option value="accessible">Accesible</option>
              </Select>
            </Field>
          </div>
        </Card>
        <Card className={styles.componentDemo}>
          <div>
            <h3>Card + Tag</h3>
            <p>El marco editorial base para métricas, documentos y estados de sistema.</p>
          </div>
          <div className={styles.cardDemoRow}>
            <Card tone="subtle">
              <Tag>PDF · Local</Tag>
              <strong>La sociedad del cansancio</strong>
              <small>38 % leído · Disponible offline</small>
            </Card>
            <Card data-theme="dark">
              <Tag>IA · Evidencia</Tag>
              <strong>Respuesta verificable</strong>
              <small>3 fuentes citadas</small>
            </Card>
          </div>
        </Card>
        </div>
      </section>

      <section aria-labelledby="product-pattern-title" className={styles.section}>
        <div className={styles.sectionHeader}>
          <span>Patrones de producto</span>
          <h2 id="product-pattern-title">El lector como frame editorial</h2>
          <p>
            La misma jerarquía visual cubre contenido disponible, permisos renovables y
            fallbacks sin ocultar la procedencia local.
          </p>
        </div>
        <ReaderPatternFrame />
      </section>
    </main>
  );
}

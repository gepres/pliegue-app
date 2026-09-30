import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { buttonClassName } from "@pliegue/ui";

import { SmoothScroll } from "./components/home/smooth-scroll";
import { InstallAppButton } from "./components/pwa/install-app";
import { ThemeToggle } from "./components/theme-toggle";
import styles from "./page.module.css";

/**
 * La portada de Pliegue: qué es y qué hace, contado como se cuenta un libro. Arriba, un pliego
 * abierto con el original y su traducción enfrentados —lo que el lector hace de verdad—; debajo,
 * las funciones como un índice de capítulos, y en el pie, los enlaces a todo: las funciones, la
 * app, el sistema visual y el diseño en Figma.
 */

export const metadata: Metadata = {
  description:
    "Pliegue reúne tu biblioteca en tu dispositivo: la indexa, la lee en PDF, EPUB y DOCX, la traduce en paralelo y guarda tus marcas. Sin cuentas y sin subir tus libros.",
  title: { absolute: "Pliegue · Tu biblioteca, por fin legible" },
};

const figmaUrl =
  "https://www.figma.com/design/2CFIc5079NMSYinTxXXTpS/Pliegue-%E2%80%94-Prototipo-de-validaci%C3%B3n-v0.1?node-id=0-1&p=f&t=t23Jxpn0Xyc2ouRm-0";

interface Chapter {
  details: string[];
  id: string;
  lead: string;
  margin: string[];
  number: string;
  title: string;
}

const chapters: Chapter[] = [
  {
    details: [
      "Vincula carpetas enteras o importa copias: los originales se quedan donde están.",
      "Un índice local con el texto, la portada y el idioma de cada documento.",
      "Fichas con autor, año, categoría, serie y tomo; los duplicados, señalados.",
      "Busca por título, autor o concepto, y ordena y filtra sin salir de la página.",
    ],
    id: "biblioteca",
    lead: "Todo lo que fuiste guardando, por fin en un solo sitio y con nombre propio.",
    margin: ["PDF · EPUB · DOCX", "PPTX · XLSX · TXT", "PNG · JPG", "Índice JSON importable"],
    number: "01",
    title: "Biblioteca",
  },
  {
    details: [
      "Un visor de PDF propio: páginas nítidas a cualquier zoom, índice y atajos de teclado.",
      "Modo Lectura: el texto del PDF recompuesto con tu tipografía, tamaño e interlineado.",
      "EPUB y DOCX por secciones, con el mismo cuidado tipográfico.",
      "Retoma donde lo dejaste, con la barra recogida mientras lees.",
    ],
    id: "lector",
    lead: "Un lector hecho para leer largo: fiel a la página o fiel al texto, tú eliges.",
    margin: ["Original · Lectura", "Tema claro y oscuro", "← → páginas · F pantalla completa"],
    number: "02",
    title: "Lector",
  },
  {
    details: [
      "Página a página y por delante de ti: cuando llegas, ya está traducida.",
      "Sobre la página, respetando imágenes y maquetación, o en paralelo con el original.",
      "En paralelo, cada frase se ilumina a la vez en los dos idiomas.",
      "Gratis y privado con el traductor del navegador, o con «Tu IA»: OpenAI, Claude, Gemini u Ollama.",
    ],
    id: "traduccion",
    lead: "Lee en tu idioma sin perder el del libro: los dos, uno al lado del otro.",
    margin: ["Chrome y Edge: en el dispositivo", "«Tu IA»: cualquier navegador", "Tecla T · Tecla P"],
    number: "03",
    title: "Traducción",
  },
  {
    details: [
      "Resaltados en cuatro colores y notas al margen, sobre la página o en el modo Lectura.",
      "Recorta una zona del PDF —un gráfico, una ilustración— y guárdala con su nota.",
      "Exporta tus notas a Markdown, con la cita breve y su página.",
      "Convierte una cita en postal: plantillas, formatos para redes y créditos de la obra.",
    ],
    id: "marcas",
    lead: "Lo que te detuvo al leer, guardado donde pasó y listo para compartir.",
    margin: ["Ámbar · Verde · Azul · Rosa", "Notas en Markdown", "Postales 1:1 · 4:5 · 9:16"],
    number: "04",
    title: "Marcas y postales",
  },
  {
    details: [
      "Cataloga tus documentos: autor, año, categoría y subcategoría, editorial, serie y tomo, sinopsis.",
      "Lo que es de la edición —ISBN, editorial, traductor— solo se guarda si figura en el libro.",
      "Con tu propia clave, que solo vive mientras la pestaña está abierta, o con Ollama en tu equipo.",
      "Solo se envía un extracto limitado; nunca el archivo completo.",
    ],
    id: "ia",
    lead: "La inteligencia que tú eliges, con tu cuenta y bajo tus reglas.",
    margin: ["OpenAI · Anthropic", "Gemini · Ollama", "Clave solo en la sesión", "O tu índice JSON"],
    number: "05",
    title: "IA con tu clave",
  },
  {
    details: [
      "Tus libros, tus marcas y tus traducciones se guardan en tu dispositivo.",
      "La cuenta es opcional, y ni con ella salen tus archivos ni su texto.",
      "Lo que viaja a un proveedor de IA es lo que tú decides enviar, y nada más.",
      "El texto de tus libros no se usa para entrenar a nadie.",
    ],
    id: "privacidad",
    lead: "Tu biblioteca es tuya. Pliegue solo la ordena.",
    margin: ["Local primero", "IndexedDB en tu navegador", "Sin rastreo"],
    number: "06",
    title: "Privacidad",
  },
  {
    details: [
      "Instálala como app de escritorio desde Chrome o Edge: su propia ventana, y abre sin conexión.",
      "Entra con Google o con tu correo, si quieres: favoritos, notas, progreso y fichas te siguen.",
      "Tus archivos no suben nunca: viaja lo que sabes de ellos, y en menos de un minuto.",
      "Sin cuenta, todo sigue en tu equipo, como siempre.",
    ],
    id: "equipos",
    lead: "Tu biblioteca en tu escritorio, y contigo en todos tus equipos.",
    margin: ["App de escritorio", "Google · correo", "Sincroniza en < 1 min"],
    number: "07",
    title: "En todos tus equipos",
  },
];

/** La cinta que corre entre la portada y el índice: lo que Pliegue hace, de un vistazo. */
const ticker = [
  "Biblioteca local",
  "PDF · EPUB · DOCX",
  "Modo Lectura",
  "Traducción en paralelo",
  "Tu IA",
  "Marcas y notas",
  "Postales",
  "App de escritorio",
  "Cuenta opcional",
  "Sincroniza entre equipos",
];

/** El camino de primeros pasos: el mismo que la app propone al terminar cada uno. */
const steps = [
  { text: "Elige una carpeta o importa tus archivos. Pliegue los indexa en tu equipo.", title: "Vincula" },
  { text: "Con tu IA o con un índice JSON: autor, categoría, serie y tomo de cada uno.", title: "Catálogo" },
  { text: "Filtra por categoría, autor o serie y ábrelos en el lector, a tu medida.", title: "Explora y lee" },
  { text: "Tradúcelos, márcalos y comparte lo que te importó.", title: "Hazlos tuyos" },
];

/** El pliego de la portada: tres frases de un libro inventado, en inglés y en español. */
const spread = {
  original: [
    "The river kept its promises better than the maps.",
    "Every spring it moved a little to the west, as if it were reading something we could not see.",
    "My grandmother called it a slow library.",
  ],
  translated: [
    "El río cumplía sus promesas mejor que los mapas.",
    "Cada primavera se movía un poco hacia el oeste, como si leyera algo que nosotros no veíamos.",
    "Mi abuela lo llamaba una biblioteca lenta.",
  ],
};

export default function HomePage() {
  return (
    <div className={styles.page}>
      <a className="skip-link" href="#contenido">
        Saltar al contenido
      </a>
      <SmoothScroll />
      {/* Cuánto se ha leído de la portada, como el hilo de avance del lector. */}
      <div aria-hidden="true" className={styles.progress} />

      <header className={styles.header}>
        <Link aria-label="Pliegue, inicio" className={styles.wordmark} href="/">
          <Image alt="" height={30} priority src="/brand/pliegue-mark.svg" width={30} />
          <span>Pliegue</span>
        </Link>
        <nav aria-label="Secciones" className={styles.nav}>
          <a href="#funciones">Funciones</a>
          <a href="#como-funciona">Cómo funciona</a>
          <a href="#privacidad">Privacidad</a>
        </nav>
        <div className={styles.headerActions}>
          <ThemeToggle compact />
          <InstallAppButton label="Instalar" size="sm" variant="quiet" />
          <Link className={buttonClassName({ size: "sm" })} href="/app">
            Abrir la app
          </Link>
        </div>
      </header>

      <main id="contenido">
        {/* ---- Portada ---------------------------------------------------------------- */}
        <section aria-labelledby="hero-title" className={styles.hero}>
          <div className={styles.heroText}>
            <p className={styles.eyebrow} style={{ "--i": 0 } as React.CSSProperties}>
              Biblioteca personal · local primero
            </p>
            <h1 id="hero-title" style={{ "--i": 1 } as React.CSSProperties}>
              Todo lo que guardaste, <em>por fin legible.</em>
            </h1>
            <p className={styles.heroLead} style={{ "--i": 2 } as React.CSSProperties}>
              Pliegue reúne tus libros y documentos en tu dispositivo, los abre en un lector
              cuidado, los traduce junto al original y guarda lo que subrayas. Sin cuenta si no la
              quieres, y sin subir nunca tus archivos.
            </p>
            <div className={styles.heroActions} style={{ "--i": 3 } as React.CSSProperties}>
              <Link className={buttonClassName({ size: "lg" })} href="/app/biblioteca">
                Abrir mi biblioteca
              </Link>
              <a className={buttonClassName({ size: "lg", variant: "secondary" })} href="#funciones">
                Ver las funciones
              </a>
            </div>
            <dl className={styles.facts} style={{ "--i": 4 } as React.CSSProperties}>
              <div>
                <dt>Formatos</dt>
                <dd>PDF, EPUB, DOCX y más</dd>
              </div>
              <div>
                <dt>Traducción</dt>
                <dd>En tu equipo o con tu IA</dd>
              </div>
              <div>
                <dt>Cuenta</dt>
                <dd>Opcional</dd>
              </div>
            </dl>
          </div>

          {/* Una ilustración del lector en paralelo: el original y su traducción enfrentados, y
              cada frase iluminada a la vez en los dos lados. Decorativa: lo que muestra lo dice
              el texto de la sección de traducción. */}
          <figure aria-hidden="true" className={styles.spread}>
            <div className={styles.book}>
              <div className={styles.leaf} lang="en">
                <span className={styles.folio}>The Slow Library · 42</span>
                <p>
                  {spread.original.map((sentence, index) => (
                    <span className={styles.sentence} key={sentence} style={{ "--pair": index } as React.CSSProperties}>
                      {sentence}{" "}
                    </span>
                  ))}
                </p>
                <span className={styles.marginNote}>releer en voz alta</span>
              </div>
              <div className={styles.gutter} />
              <div className={`${styles.leaf} ${styles.leafTranslated}`} lang="es">
                <span className={styles.folio}>42 · español</span>
                <p>
                  {spread.translated.map((sentence, index) => (
                    <span className={styles.sentence} key={sentence} style={{ "--pair": index } as React.CSSProperties}>
                      {sentence}{" "}
                    </span>
                  ))}
                </p>
                <span className={styles.dogEar} />
              </div>
            </div>
            <figcaption className={styles.spreadCaption}>
              <span className={styles.pulse} /> En paralelo · la frase se ilumina en los dos idiomas
            </figcaption>
          </figure>
        </section>

        {/* Dos copias seguidas: al desplazarse la mitad, la cinta vuelve a empezar sin salto. */}
        <div aria-hidden="true" className={styles.ticker}>
          <div className={styles.tickerTrack}>
            {[0, 1].map((copy) => (
              <span className={styles.tickerRun} key={copy}>
                {ticker.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </span>
            ))}
          </div>
        </div>

        {/* ---- Funciones: índice de capítulos -------------------------------------------- */}
        <section aria-labelledby="funciones-title" className={styles.contents} id="funciones">
          <header className={styles.sectionHead}>
            <p className={styles.eyebrow}>Índice</p>
            <h2 id="funciones-title">Siete capítulos para tu biblioteca</h2>
          </header>
          <ol className={styles.toc}>
            {chapters.map((chapter) => (
              <li key={chapter.id}>
                <a href={`#${chapter.id}`}>
                  <span>{chapter.number}</span>
                  {chapter.title}
                </a>
              </li>
            ))}
          </ol>

          {chapters.map((chapter) => (
            <article aria-labelledby={`${chapter.id}-title`} className={styles.chapter} id={chapter.id} key={chapter.id}>
              <span aria-hidden="true" className={styles.numeral}>
                {chapter.number}
              </span>
              <div className={styles.chapterBody}>
                <h3 id={`${chapter.id}-title`}>{chapter.title}</h3>
                <p className={styles.chapterLead}>{chapter.lead}</p>
                <ul className={styles.details}>
                  {chapter.details.map((detail) => (
                    <li key={detail}>{detail}</li>
                  ))}
                </ul>
              </div>
              <aside aria-label={`Detalles de ${chapter.title}`} className={styles.marginalia}>
                {chapter.margin.map((note) => (
                  <span key={note}>{note}</span>
                ))}
                {chapter.id === "marcas" ? (
                  <span aria-hidden="true" className={styles.swatches}>
                    <i data-color="amber" />
                    <i data-color="green" />
                    <i data-color="blue" />
                    <i data-color="rose" />
                  </span>
                ) : null}
              </aside>
            </article>
          ))}
        </section>

        {/* ---- Cómo funciona -------------------------------------------------------------- */}
        <section aria-labelledby="como-funciona-title" className={styles.howto} id="como-funciona">
          <header className={styles.sectionHead}>
            <p className={styles.eyebrow}>Cómo funciona</p>
            <h2 id="como-funciona-title">Cuatro pasos, y la app te guía</h2>
            <p className={styles.howtoLead}>
              Al terminar cada paso, Pliegue te propone el siguiente; en Inicio ves siempre por
              dónde vas. Sin cuenta, si no la quieres.
            </p>
          </header>
          <ol className={styles.steps}>
            {steps.map((step, index) => (
              <li key={step.title}>
                <span aria-hidden="true">{index + 1}</span>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* ---- Cierre ----------------------------------------------------------------------- */}
        <section aria-labelledby="cierre-title" className={styles.closing}>
          <p className={styles.eyebrow}>Tu biblioteca es tuya</p>
          <h2 id="cierre-title">Ábrela, léela, hazla tuya.</h2>
          <Link className={buttonClassName({ size: "lg" })} href="/app/biblioteca">
            Abrir mi biblioteca
          </Link>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={styles.footerBrand}>
          <Link aria-label="Pliegue, inicio" className={styles.wordmark} href="/">
            <Image alt="" height={26} src="/brand/pliegue-mark.svg" width={26} />
            <span>Pliegue</span>
          </Link>
          <p>Todo lo que guardaste, por fin entendible, legible y conectado.</p>
        </div>

        <nav aria-labelledby="footer-funciones" className={styles.footerColumn}>
          <h2 id="footer-funciones">Funciones</h2>
          <ul>
            {chapters.map((chapter) => (
              <li key={chapter.id}>
                <a href={`#${chapter.id}`}>{chapter.title}</a>
              </li>
            ))}
            <li>
              <a href="#como-funciona">Cómo funciona</a>
            </li>
          </ul>
        </nav>

        <nav aria-labelledby="footer-app" className={styles.footerColumn}>
          <h2 id="footer-app">La app</h2>
          <ul>
            <li>
              <Link href="/app">Inicio</Link>
            </li>
            <li>
              <Link href="/app/biblioteca">Biblioteca</Link>
            </li>
            <li>
              <Link href="/app/biblioteca/fuentes">Fuentes</Link>
            </li>
            <li>
              <Link href="/app/ia">IA</Link>
            </li>
            <li>
              <Link href="/app/ajustes">Ajustes</Link>
            </li>
            <li>
              <Link href="/app/ajustes#cuenta">Cuenta y sincronización</Link>
            </li>
            <li>
              <Link href="/app/ajustes#espacio">Instalar la app</Link>
            </li>
          </ul>
        </nav>

        <nav aria-labelledby="footer-diseno" className={styles.footerColumn}>
          <h2 id="footer-diseno">Diseño</h2>
          <ul>
            <li>
              <Link href="/design-system">Sistema visual</Link>
            </li>
            <li>
              <a href={figmaUrl} rel="noreferrer" target="_blank">
                Abrir en Figma
                <span aria-hidden="true"> ↗</span>
                <span className={styles.visuallyHidden}> (se abre en otra pestaña)</span>
              </a>
            </li>
          </ul>
        </nav>

        <div className={styles.footerBase}>
          <span>Pliegue · v0.1 · local primero</span>
          <ThemeToggle />
        </div>
      </footer>
    </div>
  );
}

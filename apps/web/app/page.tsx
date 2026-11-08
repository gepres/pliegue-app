import type { Metadata } from "next";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import { buttonClassName } from "@pliegue/ui";

import { BrandMark } from "./components/brand/brand-mark";
import { AskTheBook } from "./components/home/book-question";
import { PaperToneSample } from "./components/home/paper-tone-sample";
import { PostcardSample } from "./components/home/postcard-sample";
import { SmoothScroll } from "./components/home/smooth-scroll";
import { InstallAppButton } from "./components/pwa/install-app";
import { ThemeToggle } from "./components/theme-toggle";
import { TranslationModes } from "./components/home/translation-modes";
import styles from "./page.module.css";

/**
 * La portada de Pliegue, contada como un libro (02.9d).
 * - Arriba, un pliego abierto en el que se le pregunta algo al libro y Pliegue responde citándolo.
 * - Debajo, las «Notas a esta edición»: lo que la app ya hace y la portada aún no contaba.
 * - Después, el índice y cuatro Partes con el lema de la marca: entendible, legible, conectado y
 *   «tus reglas». Cada Parte abre con su pliego de ejemplo y lleva sus capítulos.
 * - Al final, cómo empezar, las preguntas de antes de empezar y el pie.
 *
 * Todo lo que se afirma aquí lo hace la app hoy (ver `PRODUCT.md`). Los ejemplos —el libro, la
 * recomendación, el registro de la IA— son inventados y se dicen ejemplos. El precio de Buscalibre
 * para el admin (06.2b) no se anuncia.
 */

export const metadata: Metadata = {
  description:
    "Pliegue reúne tu biblioteca en tu dispositivo: la lee en PDF, EPUB y DOCX, la traduce junto al original, te contesta citando tus libros y te recomienda qué leer. Gratis y sin subir tus archivos.",
  title: { absolute: "Pliegue · Todo lo que guardaste, por fin entendible" },
};

interface Chapter {
  /** Un botón propio del capítulo, con su aclaración. */
  action?: { href: string; label: string; note: string };
  details: string[];
  /** Capítulo destacado: a todo el ancho, con su ejemplo al lado (02.9d, a pedido del dueño). */
  feature?: Feature;
  id: string;
  lead: string;
  /** Notas al margen, en cursiva de lectura. */
  margin: string[];
  number: string;
  /** Datos de verdad (formatos, proporciones, proveedores), en letra de máquina. */
  specs?: string[];
  /** Pasos numerados, en lugar de los detalles. */
  steps?: { text: string; title: string }[];
  title: string;
}

type Demo = "devices" | "ledger" | "recommend" | "tone";
type Feature = "postcard" | "share" | "translation";

interface Part {
  chapters: Chapter[];
  demo: Demo;
  id: string;
  numeral: string;
  statement: string;
  title: string;
}

const parts: Part[] = [
  {
    chapters: [
      {
        details: [
          "Vincula carpetas enteras o importa copias: los originales se quedan donde están.",
          "Un índice en tu equipo con el texto, la portada y el idioma de cada documento.",
          "Fichas con autor, año, categoría, serie y tomo, con tu IA o con un índice JSON, y vista previa antes de aplicarlas. Los repetidos, señalados.",
        ],
        id: "biblioteca",
        lead: "Todo lo que fuiste guardando, en un solo sitio y con nombre propio.",
        margin: ["Los originales, intactos"],
        specs: ["PDF · EPUB · DOCX · PPTX · XLSX · TXT · imágenes"],
        number: "01",
        title: "Biblioteca",
      },
      {
        details: [
          "Busca por palabras, siempre en tu equipo, y por significado con tu IA.",
          "Responde solo con lo que dicen tus libros: cada idea lleva su cita, comprobada antes de enseñártela, y te lleva al pasaje.",
          "Resume un libro entero en unos párrafos y puntos, también con sus citas. Antes de enviarlo te dice a quién y cuánto costará.",
        ],
        id: "pregunta",
        lead: "Pregunta con tus palabras y te contesta con las de tus libros.",
        margin: ["Cada cita, comprobada", "La respuesta se guarda como nota"],
        specs: ["Por significado: OpenAI · Gemini · Ollama"],
        number: "02",
        title: "Pregúntale a tu biblioteca",
      },
      {
        details: [
          "Recomendaciones a partir de los temas y autores que eliges; con tu permiso, también de tu biblioteca, sin enviar nunca un título.",
          "Cada libro dice por qué te lo propone, y lo que descartas no vuelve.",
          "Dónde conseguirlo: Buscalibre en tu país y el precio del libro digital en Google Play, con la fecha de la consulta.",
        ],
        id: "para-ti",
        lead: "Qué leer después, con su porqué, y dónde encontrarlo.",
        margin: ["Libros de Open Library", "Seis tiendas de Buscalibre", "Sin enlaces de afiliado"],
        number: "03",
        title: "Para ti y dónde conseguirlo",
      },
    ],
    demo: "recommend",
    id: "entendible",
    numeral: "I",
    statement: "Tu biblioteca ordenada y dispuesta a contestarte: la buscas por lo que dice, no solo por cómo se llama.",
    title: "Entendible",
  },
  {
    chapters: [
      {
        details: [
          "Un visor de PDF propio, nítido a cualquier zoom, y el modo Lectura: el texto recompuesto con tu tipografía, tamaño e interlineado.",
          "EPUB y DOCX por secciones, con sus imágenes y los pies de figura en su sitio.",
          "Tono del papel —sepia, cálido o gris—, atenuar, PDF en modo noche y una banda de enfoque que sigue al puntero.",
        ],
        id: "lector",
        lead: "Fiel a la página o fiel al texto, en el papel que prefieras.",
        margin: ["Fiel a la página o al texto", "Con atajos de teclado", "Probado con lector de pantalla"],
        number: "04",
        title: "Lector y papel",
      },
      {
        details: [
          "Página a página y por delante de ti: sobre la página o en paralelo, con cada frase iluminada en los dos idiomas.",
          "Traduce el libro entero, con el coste a la vista antes de empezar.",
          "Gratis y en tu equipo con el traductor del navegador, o con tu IA. Si quieres, las traducciones se guardan en tu cuenta.",
        ],
        feature: "translation",
        id: "traduccion",
        lead: "Lee en tu idioma sin perder el del libro.",
        margin: ["En Chrome y Edge, en el dispositivo", "Con tu IA, en cualquier navegador"],
        number: "05",
        title: "Traducción",
      },
      {
        details: [
          "Lee con OCR, en tu equipo, una zona de una imagen o de un escaneo, y tradúcela.",
          "Una página escaneada se lee con OCR en el modo Lectura y al traducir, y se queda guardada.",
          "Los PDF escaneados se buscan por lo que ya se leyó, y al catalogarlos se lee su principio.",
        ],
        id: "escaneos",
        lead: "Lo escaneado también se lee, se busca y se traduce.",
        margin: ["El OCR, en tu equipo", "Una zona o la página entera"],
        number: "06",
        title: "Escaneos que se leen",
      },
      {
        details: [
          "Resaltados en cuatro colores y notas al margen, sobre la página o en el modo Lectura.",
          "Recorta una zona del PDF y guárdala con su nota; exporta tus notas a Markdown.",
          "Convierte una cita en postal, con plantillas, formatos para redes y los créditos de la obra.",
        ],
        feature: "postcard",
        id: "marcas",
        lead: "Lo que te detuvo al leer, guardado donde pasó y listo para compartir.",
        margin: ["Con los créditos de la obra", "Tus notas, exportables a Markdown"],
        number: "07",
        title: "Marcas y postales",
      },
    ],
    demo: "tone",
    id: "legible",
    numeral: "II",
    statement: "Un lector para leer largo, en tu idioma y en el papel que prefieras.",
    title: "Legible",
  },
  {
    chapters: [
      {
        details: [
          "Instálala como app de escritorio desde Chrome o Edge: su propia ventana, y abre sin conexión.",
          "Entra con Google o con tu correo, si quieres: favoritos, notas, progreso, fichas y ajustes te siguen. Tus archivos no suben nunca.",
          "Ves qué libros tienes en otros equipos y, si dos cambian lo mismo, el historial te deja recuperar la otra versión.",
        ],
        id: "equipos",
        lead: "Tu biblioteca en tu escritorio, y contigo en todos tus equipos.",
        margin: ["Como app de escritorio", "Con Google o con tu correo", "Sin cuenta, todo en tu equipo"],
        number: "08",
        title: "En todos tus equipos",
      },
      {
        action: {
          href: "/app/ajustes/mi-biblioteca",
          label: "Publicar mi biblioteca",
          note: "Para publicarla necesitas una cuenta de Pliegue; para leerla, solo el código.",
        },
        details: [],
        feature: "share",
        id: "compartir",
        lead: "Tu club de lectura, tu clase o tu familia leen tus libros en Pliegue con un código, sin crearse una cuenta. Los archivos se quedan en tu Drive y tú decides quién entra y hasta cuándo.",
        steps: [
          { text: "Una carpeta de tu Google Drive que vea cualquiera con el enlace. Pliegue la abre como biblioteca, con tu nombre en la dirección.", title: "Elige tu carpeta" },
          { text: "Con caducidad y usos máximos. Cada código es un enlace listo para enviar, y quien lo recibe lee en el mismo lector.", title: "Reparte códigos" },
          { text: "Quién entró, cuándo y desde qué navegador. Sacas a quien quieras, cuando quieras.", title: "Mira quién lee" },
        ],
        margin: ["Lectores sin cuenta", "Tus archivos, en tu Drive"],
        specs: ["/biblioteca/tu-nombre/CÓDIGO"],
        number: "09",
        title: "Comparte tu biblioteca",
      },
    ],
    demo: "devices",
    id: "conectado",
    numeral: "III",
    statement: "Contigo en todos tus equipos, y abierta a quien tú invites: tu club de lectura, tu clase o tu familia.",
    title: "Conectado",
  },
  {
    chapters: [
      {
        details: [
          "OpenAI, Anthropic, Gemini u Ollama en tu equipo: una para catalogar, otra para traducir, otra para preguntar o recomendar.",
          "Un presupuesto al mes que avisa al 80 % y se detiene al 100 %, y un registro de qué salió, adónde y cuánto, sin textos ni títulos.",
          "Tu clave, como quieras: solo en la pestaña, cifrada en el navegador o en tu cuenta con una frase que solo tú sabes.",
        ],
        id: "ia",
        lead: "La inteligencia que tú eliges, una para cada tarea y con tu cuenta.",
        margin: ["Bóveda de claves cifrada", "Presupuesto y registro"],
        specs: ["OpenAI · Anthropic · Gemini · Ollama"],
        number: "10",
        title: "IA a tu medida",
      },
      {
        details: [
          "Tus libros, tus marcas y tus traducciones se guardan en tu dispositivo; la cuenta es opcional y ni con ella salen tus archivos.",
          "Marca una carpeta o un libro como confidencial y no sale a ninguna IA en la nube; lo personal te pide permiso antes.",
          "Lo que viaja a un proveedor de IA es lo que tú decides enviar, y nada más.",
        ],
        id: "privacidad",
        lead: "Tu biblioteca es tuya. Pliegue solo la ordena.",
        margin: ["Local primero", "Sin rastreo"],
        specs: ["Público · interno · personal · confidencial"],
        number: "11",
        title: "Privacidad",
      },
      {
        details: [
          "¿En el móvil, en Safari o en Firefox? Importa tus libros como copias y léelos en el mismo lector; llévatelas todas en un ZIP.",
          "Una copia de seguridad con favoritos, avance, notas, fichas y ajustes, que restauras en otro equipo con vista previa.",
          "Y si un día te vas, borras tu cuenta y lo sincronizado, y «Borrar todo» deja el navegador limpio.",
        ],
        id: "tus-datos",
        lead: "Lo que guardas en Pliegue sale de Pliegue cuando tú quieras.",
        margin: [],
        specs: ["ZIP · JSON · Markdown"],
        number: "12",
        title: "Tus datos, contigo",
      },
    ],
    demo: "ledger",
    id: "tus-reglas",
    numeral: "IV",
    statement: "La IA que tú eliges, con tu clave, y lo que sale de tu equipo, decidido por ti.",
    title: "Tus reglas",
  },
];

/** Lo que la app ya hace y esta portada aún no contaba (02.9d). Cada nota lleva a su capítulo. */
const editionNotes = [
  { chapter: "pregunta", text: "Te contesta citando tus libros, y resume uno entero.", title: "Pregúntale a tu biblioteca" },
  { chapter: "para-ti", text: "Qué leer después, con su porqué, y dónde encontrarlo.", title: "Para ti y dónde conseguirlo" },
  { chapter: "ia", text: "Una IA para cada tarea, presupuesto, registro y tu clave cifrada.", title: "IA a tu medida" },
  { chapter: "lector", text: "Sepia, cálido o gris, atenuar y una banda de enfoque.", title: "Tono del papel" },
  { chapter: "escaneos", text: "OCR en tu equipo, y escaneos que se buscan.", title: "Escaneos que se leen" },
  { chapter: "traduccion", text: "Con el coste a la vista antes de empezar.", title: "El libro entero, traducido" },
];

/** El camino de primeros pasos: el mismo que la app propone al terminar cada uno. */
const steps = [
  { text: "Elige una carpeta o importa tus archivos. Pliegue los indexa en tu equipo.", title: "Vincula" },
  { text: "Con tu IA o con un índice JSON: autor, categoría, serie y tomo, con vista previa.", title: "Cataloga" },
  { text: "Ábrelos en el lector, a tu medida, y pregúntale a tu biblioteca.", title: "Lee y pregunta" },
  { text: "Tradúcelos, márcalos y comparte lo que te importó.", title: "Hazlos tuyos" },
];

/** Lo que se pregunta quien decide si empezar. */
const questions = [
  {
    answer: "Pliegue es gratis. Si usas IA, le pagas a tu proveedor con tu propia clave; con Ollama en tu equipo, nada.",
    question: "¿Cuesta algo?",
  },
  {
    answer:
      "Funciona en el navegador: importas tus libros como copias y los lees igual. Vincular carpetas y traducir en el dispositivo son de Chrome y Edge en el escritorio.",
    question: "¿Y en el móvil?",
  },
  {
    answer:
      "Solo lo que tú decides enviar: un extracto para catalogar, los fragmentos de una pregunta o el texto que traduces. Queda en el registro, y lo confidencial no sale.",
    question: "¿Qué ve la IA?",
  },
];

/** El registro de la tarjeta de ejemplo de una biblioteca compartida: nombres inventados. */
const sharingLog = [
  { name: "Marta", when: "hace 2 h · volvió" },
  { name: "Julián", when: "ayer" },
  { name: "Clara", when: "el lunes" },
];

/** El registro de la IA de ejemplo (Parte IV): inventado, con las columnas del de la app. */
const ledger = [
  { kept: false, sent: "12 fichas", task: "Catalogar", via: "Gemini" },
  { kept: false, sent: "En tu equipo", task: "Traducir", via: "Navegador" },
  { kept: false, sent: "8 fragmentos", task: "Preguntar", via: "Claude" },
  { kept: true, sent: "No salió: confidencial", task: "Catalogar", via: "—" },
];

function RecommendDemo() {
  return (
    <figure aria-label="Ejemplo: una recomendación de «Para ti» y dónde conseguirla" className={styles.slip}>
      <div className={styles.slipCard}>
        <p className={styles.slipLabel}>Para ti · ejemplo</p>
        <p className={styles.slipTitle}>Kafka en la orilla</p>
        <p className={styles.slipAuthor}>Haruki Murakami · 2002</p>
        <ul className={styles.slipReasons}>
          <li>Porque te interesa: realismo mágico</li>
          <li>De Haruki Murakami, que te gusta</li>
        </ul>
      </div>
      <div className={styles.slipStore}>
        <p className={styles.slipLabel}>Dónde conseguirlo</p>
        <p>
          <strong>Buscalibre Perú</strong> · precio, envío y promociones
        </p>
        <p>
          <strong>S/ 35,90</strong> · eBook en Google Play · consultado el 8 nov.
        </p>
      </div>
    </figure>
  );
}

function PassDemo() {
  return (
    <figure aria-label="Ejemplo: un código de acceso a una biblioteca compartida y quién entró" className={styles.pass}>
      <div className={styles.passCard}>
        <div className={styles.passMain}>
          <span className={styles.passLabel}>Ejemplo · los libros de Ana · código de acceso</span>
          <strong className={styles.passCode}>OCT26</strong>
          <span className={styles.passLink}>/biblioteca/ana/OCT26</span>
          <span className={styles.passFacts}>
            <span>
              <small>Caduca</small> 31 oct
            </span>
            <span>
              <small>Usos</small> 12 de 30
            </span>
          </span>
        </div>
        <span aria-hidden="true" className={styles.passStub}>
          Pase de lectura
        </span>
      </div>
      <div className={styles.passRegistry}>
        <span className={styles.passLabel}>Quién entró</span>
        <ul>
          {sharingLog.map((entry) => (
            <li key={entry.name}>
              <strong>{entry.name}</strong>
              <span>{entry.when}</span>
            </li>
          ))}
        </ul>
      </div>
    </figure>
  );
}

function LedgerDemo() {
  return (
    <figure aria-label="Ejemplo: el registro y el gasto de la IA en un mes" className={styles.ledger}>
      <div className={styles.ledgerCard}>
        <p className={styles.ledgerTitle}>
          Registro de la IA <span>ejemplo · noviembre</span>
        </p>
        <table>
          <thead>
            <tr>
              <th scope="col">Tarea</th>
              <th scope="col">Con</th>
              <th scope="col">Qué salió</th>
            </tr>
          </thead>
          <tbody>
            {ledger.map((row) => (
              <tr data-kept={row.kept} key={`${row.task}-${row.sent}`}>
                <td>{row.task}</td>
                <td>{row.via}</td>
                <td>{row.sent}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className={styles.ledgerBudget}>
          Gastado este mes <strong>US$ 0,41</strong> de US$ 5 · avisa al 80{" "}%
        </p>
      </div>
      <span aria-hidden="true" className={styles.stamp}>
        Confidencial · no sale
      </span>
    </figure>
  );
}

/** Los equipos de una cuenta de ejemplo (Parte III): inventados. */
const devices = [
  { name: "Escritorio de casa", state: "este equipo · 214 libros" },
  { name: "Portátil", state: "sincronizado hace 2 min · 86 libros" },
  { name: "Móvil", state: "copias importadas · 12 libros" },
];

function DevicesDemo() {
  return (
    <figure aria-label="Ejemplo: una cuenta de Pliegue en tres equipos" className={styles.devices}>
      <div className={styles.devicesCard}>
        <p className={styles.devicesTitle}>
          Tus equipos <span>ejemplo</span>
        </p>
        <ul>
          {devices.map((device) => (
            <li key={device.name}>
              <strong>{device.name}</strong>
              <span>{device.state}</span>
            </li>
          ))}
        </ul>
        <p className={styles.devicesNote}>Viajan favoritos, notas, progreso, fichas y ajustes. Tus archivos, no.</p>
      </div>
    </figure>
  );
}

const demos: Record<Demo, () => ReactNode> = {
  devices: DevicesDemo,
  ledger: LedgerDemo,
  recommend: RecommendDemo,
  tone: PaperToneSample,
};

/** El ejemplo de cada capítulo destacado. */
const features: Record<Feature, () => ReactNode> = {
  postcard: PostcardSample,
  share: PassDemo,
  translation: TranslationModes,
};

function ChapterArticle({ chapter }: { chapter: Chapter }) {
  const FeatureDemo = chapter.feature ? features[chapter.feature] : null;
  return (
    <article
      aria-labelledby={`${chapter.id}-title`}
      className={FeatureDemo ? `${styles.chapter} ${styles.featured}` : styles.chapter}
      id={chapter.id}
    >
      <div className={styles.chapterMain}>
        <header className={styles.chapterHead}>
          <span aria-hidden="true" className={styles.numeral}>
            {chapter.number}
          </span>
          <h3 id={`${chapter.id}-title`}>{chapter.title}</h3>
        </header>
        <p className={styles.chapterLead}>{chapter.lead}</p>
        {chapter.details.length ? (
          <ul className={styles.details}>
            {chapter.details.map((detail) => (
              <li key={detail}>{detail}</li>
            ))}
          </ul>
        ) : null}
        {chapter.steps ? (
          <ol className={styles.chapterSteps}>
            {chapter.steps.map((step) => (
              <li key={step.title}>
                <strong>{step.title}.</strong> {step.text}
              </li>
            ))}
          </ol>
        ) : null}
        {chapter.action ? (
          <div className={styles.chapterAction}>
            <Link className={buttonClassName({ size: FeatureDemo ? "lg" : "md", variant: FeatureDemo ? "primary" : "secondary" })} href={chapter.action.href}>
              {chapter.action.label}
            </Link>
            <p>{chapter.action.note}</p>
          </div>
        ) : null}
      </div>
      <aside aria-label={`Notas de ${chapter.title}`} className={styles.marginalia}>
        {chapter.margin.length ? (
          <ul>
            {chapter.margin.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        ) : null}
        {chapter.specs?.map((spec) => (
          <p className={styles.specs} key={spec}>
            {spec}
          </p>
        ))}
      </aside>
      {FeatureDemo ? (
        <div className={styles.featureDemo}>
          <FeatureDemo />
        </div>
      ) : null}
    </article>
  );
}

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
          <BrandMark size={30} />
          <span>Pliegue</span>
        </Link>
        <nav aria-label="Partes" className={styles.nav}>
          {parts.map((part) => (
            <a href={`#${part.id}`} key={part.id}>
              {part.title}
            </a>
          ))}
        </nav>
        <div className={styles.headerActions}>
          <a className={styles.navIndex} href="#indice">
            Índice
          </a>
          <span className={styles.headerTheme}>
            <ThemeToggle compact />
          </span>
          <InstallAppButton className={styles.install} label="Instalar" labelClassName={styles.installLabel} size="sm" variant="quiet" />
          <Link className={buttonClassName({ size: "sm" })} href="/app">
            Abrir la app
          </Link>
        </div>
      </header>

      <main id="contenido">
        {/* ---- Portada: el lema y un libro al que se le pregunta -------------------------------- */}
        {/* En este orden también se recorre con el teclado: en el móvil, el libro va entre los
            botones y los datos, para que asome en la primera pantalla sin esconder la acción. */}
        <section aria-labelledby="hero-title" className={styles.hero}>
          <h1 className={styles.heroTitle} id="hero-title" style={{ "--i": 0 } as CSSProperties}>
            Todo lo que guardaste, por fin <em>entendible, legible y conectado.</em>
          </h1>
          <p className={styles.heroLead} style={{ "--i": 1 } as CSSProperties}>
            Pliegue reúne tus libros y documentos en tu dispositivo, los abre en un lector cuidado, los traduce junto al original
            y te contesta citándolos.
          </p>
          <div className={styles.heroActions} style={{ "--i": 2 } as CSSProperties}>
            <Link className={buttonClassName({ size: "lg" })} href="/app/biblioteca">
              Abrir mi biblioteca
            </Link>
            <a className={buttonClassName({ size: "lg", variant: "secondary" })} href="#indice">
              Ver el índice
            </a>
          </div>
          <div className={styles.heroBook}>
            <AskTheBook />
          </div>
          <dl className={styles.facts} style={{ "--i": 3 } as CSSProperties}>
            <div>
              <dt>Precio</dt>
              <dd>Gratis; la IA, con tu clave</dd>
            </div>
            <div>
              <dt>Tus archivos</dt>
              <dd>Nunca se suben</dd>
            </div>
            <div>
              <dt>Cuenta</dt>
              <dd>Opcional</dd>
            </div>
          </dl>
        </section>

        {/* ---- Notas a esta edición: lo nuevo, con su capítulo ------------------------------------ */}
        <section aria-labelledby="notas-title" className={styles.notes} id="notas">
          <div className={styles.notesHead}>
            <h2 id="notas-title">Notas a esta edición</h2>
            <p>Lo que Pliegue ya hace y esta portada aún no contaba.</p>
          </div>
          <ol className={styles.notesList}>
            {editionNotes.map((note) => (
              <li key={note.chapter + note.title}>
                <a href={`#${note.chapter}`}>
                  <strong>{note.title}</strong>
                  <span>{note.text}</span>
                </a>
              </li>
            ))}
          </ol>
        </section>

        {/* ---- Índice: cuatro Partes y sus capítulos ---------------------------------------------- */}
        <section aria-labelledby="indice-title" className={styles.contents} id="indice">
          <h2 id="indice-title">Índice</h2>
          <ol className={styles.toc}>
            {parts.map((part) => (
              <li key={part.id}>
                <a className={styles.tocPart} href={`#${part.id}`}>
                  <span>Parte {part.numeral}</span> {part.title}
                </a>
                <ol>
                  {part.chapters.map((chapter) => (
                    <li key={chapter.id}>
                      <a href={`#${chapter.id}`}>
                        {chapter.title}
                        <span>{chapter.number}</span>
                      </a>
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ol>
        </section>

        {/* ---- Las cuatro Partes: cada una abre con su pliego -------------------------------------- */}
        {parts.map((part) => {
          const PartDemo = demos[part.demo];
          return (
            <section aria-labelledby={`${part.id}-title`} className={styles.part} id={part.id} key={part.id}>
              <div className={styles.partOpening}>
                <div className={styles.partText}>
                  <span aria-hidden="true" className={styles.partNumeral}>
                    {part.numeral}
                  </span>
                  <h2 id={`${part.id}-title`}>
                    <span className={styles.visuallyHidden}>Parte {part.numeral}: </span>
                    {part.title}
                  </h2>
                  <p className={styles.partStatement}>{part.statement}</p>
                </div>
                <div className={styles.partDemo}>
                  <PartDemo />
                </div>
              </div>
              <div
                className={styles.chapters}
                data-count={part.chapters.length}
                data-layout={part.chapters.some((chapter) => chapter.feature) ? "stack" : "grid"}
              >
                {part.chapters.map((chapter) => (
                  <ChapterArticle chapter={chapter} key={chapter.id} />
                ))}
              </div>
            </section>
          );
        })}

        {/* ---- Cómo empezar y lo que se pregunta antes ----------------------------------------------- */}
        <section aria-labelledby="como-funciona-title" className={styles.howto} id="como-funciona">
          <div className={styles.sectionHead}>
            <h2 id="como-funciona-title">Cuatro pasos, y la app te guía</h2>
            <p className={styles.howtoLead}>
              Al terminar cada paso, Pliegue te propone el siguiente; en Inicio ves siempre por dónde vas.
            </p>
          </div>
          <ol className={styles.steps}>
            {steps.map((step, index) => (
              <li key={step.title}>
                <span aria-hidden="true">{index + 1}</span>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </li>
            ))}
          </ol>
          <div className={styles.faq}>
            <h3>Antes de empezar</h3>
            <dl>
              {questions.map((item) => (
                <div key={item.question}>
                  <dt>{item.question}</dt>
                  <dd>{item.answer}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* ---- Cierre ----------------------------------------------------------------------------------- */}
        <section aria-labelledby="cierre-title" className={styles.closing}>
          <h2 id="cierre-title">Ábrela, léela, pregúntale.</h2>
          <Link className={buttonClassName({ size: "lg" })} href="/app/biblioteca">
            Abrir mi biblioteca
          </Link>
          <p>Gratis. En Chrome o Edge vinculas tus carpetas; en cualquier navegador, importas copias.</p>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={styles.footerBrand}>
          <Link aria-label="Pliegue, inicio" className={styles.wordmark} href="/">
            <BrandMark size={26} />
            <span>Pliegue</span>
          </Link>
          <p>Todo lo que guardaste, por fin entendible, legible y conectado.</p>
        </div>

        <nav aria-labelledby="footer-portada" className={styles.footerColumn}>
          <h2 id="footer-portada">La portada</h2>
          <ul>
            <li>
              <a href="#notas">Notas a esta edición</a>
            </li>
            {parts.map((part) => (
              <li key={part.id}>
                <a href={`#${part.id}`}>
                  Parte {part.numeral} · {part.title}
                </a>
              </li>
            ))}
            <li>
              <a href="#como-funciona">Cómo empezar</a>
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
              <Link href="/app/para-ti">Para ti</Link>
            </li>
            <li>
              <Link href="/app/ia">IA</Link>
            </li>
            <li>
              <Link href="/app/ajustes">Ajustes</Link>
            </li>
            <li>
              <Link href="/app/ajustes/mi-biblioteca">Mi biblioteca compartida</Link>
            </li>
          </ul>
        </nav>

        <div className={styles.footerBase}>
          <span>Pliegue · local primero</span>
          <Link href="/design-system">Sistema visual</Link>
          <span className={styles.footerTheme}>
            <ThemeToggle />
          </span>
        </div>
      </footer>
    </div>
  );
}

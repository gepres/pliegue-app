"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  canvasOutputScale,
  currentPageNumber,
  fitToWidthScale,
  nextZoomStep,
  pageFromProgressPercent,
  pageGap,
  pageProgressPercent,
  placePages,
  scrollTopForPage,
  totalHeight,
  visiblePageRange,
  type PdfPagePlacement,
  type PdfPageSize,
} from "../library/pdf-page-layout";
import type { HighlightColor, NormalizedRect } from "../library/annotations";
import { reflowPage, toReflowItems } from "../library/pdf-reflow";
import { describePdfFailure, openPdfDocument } from "../library/pdf-runtime";
import type { StructuredDocumentBlock } from "../library/structured-document-extractor";
import { ExtractedBlocks } from "./extracted-blocks";
import { IconButton, Segmented } from "./app-ui/controls";
import { Icon } from "./app-ui/icons";
import { Popover } from "./app-ui/overlays";
import type { OutlineItem } from "./reader/outline";
import styles from "./pdf-reader.module.css";

type PdfDocument = Awaited<ReturnType<typeof openPdfDocument>>["document"];

/** Páginas cuyo tamaño se pide de una vez al abrir; evita miles de promesas simultáneas. */
const sizeBatch = 16;

/** Ancho máximo de página al ajustar: cómodo de leer sin mover la cabeza. */
const comfortablePageWidth = 1040;

/** Páginas que se recomponen de una tanda en el modo lectura. */
const reflowBatch = 8;

export type PdfViewMode = "original" | "reading";

interface ReflowedPage {
  blocks: StructuredDocumentBlock[];
  columns: number;
  number: number;
}

/** Recompone una página: el ancho sale del propio documento, no de la pantalla. */
async function reflowDocumentPage(
  document: PdfDocument,
  number: number,
): Promise<ReflowedPage> {
  const page = await document.getPage(number);

  try {
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const { blocks, columns } = reflowPage(
      toReflowItems(content.items as Parameters<typeof toReflowItems>[0]),
      viewport.width,
    );
    return { blocks, columns, number };
  } finally {
    page.cleanup();
  }
}

type ReaderState =
  | { message: string; status: "error" }
  | { status: "loading" }
  | { document: PdfDocument; sizes: PdfPageSize[]; status: "ready" };

export interface PdfReaderProps {
  blob: Blob;
  /** Modo recorte: arrastrar sobre una página dibuja una zona en lugar de seleccionar texto. */
  cropMode?: boolean;
  onCropModeChange?: (active: boolean) => void;
  /** Zona recién recortada, a la espera de que se elija qué hacer con ella. */
  pendingRegion?: { page: number; rect: NormalizedRect } | null;
  onRegionSelected?: (region: { page: number; rect: NormalizedRect }, rect: DOMRect) => void;
  /** Zonas marcadas de todo el documento. */
  regions?: readonly PdfRegionMark[];
  onRegionClick?: (id: string, rect: DOMRect) => void;
  /** Recibe las herramientas de zona cuando el documento está listo, y `null` al cerrarse. */
  onRegionTools?: (tools: PdfRegionTools | null) => void;
  /** Avance guardado, para retomar en la página que corresponda. */
  initialPercent?: number;
  onError?: (message: string) => void;
  /** Marcadores del PDF, resueltos a número de página, para el índice del panel. */
  onOutline?: (items: OutlineItem[]) => void;
  /** Página que se está leyendo y total, para la barra del lector. */
  onPageChange?: (page: number, pageCount: number) => void;
  /** Avance real, contado en páginas. Sustituye a la medición por desplazamiento. */
  onProgressChange?: (percent: number) => void;
  onReady?: () => void;
  /** Petición de salto desde fuera (el índice); `nonce` permite repetir la misma página. */
  pageRequest?: { nonce: number; page: number } | null;
  /** Cambia de valor para pedir la vuelta a la primera página. */
  restartSignal?: number;
  /** Solo salta a la posición guardada cuando el usuario lo ha pedido. */
  resumeRequested?: boolean;
  title: string;
}

/**
 * Lee los tamaños de todas las páginas antes de dibujar ninguna.
 *
 * Es el precio de no dibujar el documento entero: para reservar el hueco de cada página y
 * saber cuáles caen dentro de la ventana hay que conocer su alto de antemano. `getPage` solo
 * consulta el índice del archivo —lo caro es `render`—, así que el coste es asumible incluso
 * en documentos largos.
 */
async function readPageSizes(document: PdfDocument, signal: { cancelled: boolean }) {
  const sizes: PdfPageSize[] = [];

  for (let start = 1; start <= document.numPages; start += sizeBatch) {
    const numbers = Array.from(
      { length: Math.min(sizeBatch, document.numPages - start + 1) },
      (_, offset) => start + offset,
    );
    const batch = await Promise.all(
      numbers.map(async (number) => {
        const page = await document.getPage(number);
        const viewport = page.getViewport({ scale: 1 });
        return { height: viewport.height, width: viewport.width };
      }),
    );

    if (signal.cancelled) return sizes;
    sizes.push(...batch);
  }

  return sizes;
}

/** Número máximo de marcadores que se muestran: un índice de mil entradas no se lee. */
const outlineLimit = 300;

/**
 * Marcadores del PDF aplanados en una lista con nivel. El destino de cada uno puede venir
 * con nombre o como referencia a la página; los dos se resuelven a un número de página.
 */
async function readPdfOutline(document: PdfDocument): Promise<OutlineItem[]> {
  type Node = { dest: unknown; items?: Node[]; title: string };
  const outline = (await document.getOutline()) as Node[] | null;
  if (!outline?.length) return [];

  const items: OutlineItem[] = [];

  async function resolvePage(dest: unknown): Promise<number | null> {
    try {
      const explicit = typeof dest === "string" ? await document.getDestination(dest) : dest;
      if (!Array.isArray(explicit) || explicit.length === 0) return null;
      const reference = explicit[0] as unknown;
      if (typeof reference === "number") return reference + 1;
      const index = await document.getPageIndex(reference as Parameters<PdfDocument["getPageIndex"]>[0]);
      return index + 1;
    } catch {
      return null;
    }
  }

  async function walk(nodes: Node[], level: number) {
    for (const node of nodes) {
      if (items.length >= outlineLimit) return;
      const page = await resolvePage(node.dest);
      if (page !== null) {
        items.push({
          id: `pdf-outline-${items.length}`,
          label: node.title.trim() || `Página ${page}`,
          level,
          meta: String(page),
          target: { kind: "page", page },
        });
      }
      if (node.items?.length && level < 2) await walk(node.items, level + 1);
    }
  }

  await walk(outline, 0);
  return items;
}

/** Una zona marcada sobre la página, en coordenadas relativas a ella. */
export interface PdfRegionMark {
  color: HighlightColor;
  hasNote: boolean;
  id: string;
  page: number;
  rect: NormalizedRect;
}

const noRegions: readonly PdfRegionMark[] = [];

const PdfPage = memo(function PdfPage({
  crop,
  document,
  onRegionClick,
  placement,
  regions,
  scale,
  shouldRender,
  title,
}: {
  /** Zona que se está recortando o recién recortada en esta página. */
  crop: NormalizedRect | null;
  document: PdfDocument;
  onRegionClick?: ((id: string, rect: DOMRect) => void) | undefined;
  placement: PdfPagePlacement;
  regions: readonly PdfRegionMark[];
  scale: number;
  shouldRender: boolean;
  title: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const pageNumber = placement.number;

  useEffect(() => {
    const canvas = canvasRef.current;
    const textContainer = textLayerRef.current;
    // Que la página esté dibujada es un hecho del DOM, no estado de React: nada del árbol
    // depende de él salvo el fondo de espera, así que se marca en el propio elemento.
    const markDrawn = (value: boolean) => {
      if (frameRef.current) frameRef.current.dataset.drawn = value ? "true" : "false";
    };

    if (!shouldRender) {
      // Al alejarse, soltar el mapa de bits: un canvas de página completa a densidad doble
      // ocupa varios megas y el navegador no lo recupera solo mientras el nodo siga vivo.
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
      if (textContainer) textContainer.replaceChildren();
      markDrawn(false);
      return;
    }

    if (!canvas || !textContainer) return;

    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<void> } | null = null;
    let textLayer: { cancel: () => void; render: () => Promise<unknown> } | null = null;

    async function draw(targetCanvas: HTMLCanvasElement, container: HTMLDivElement) {
      const page = await document.getPage(pageNumber);
      if (cancelled) return;

      const viewport = page.getViewport({ scale });
      const outputScale = canvasOutputScale(window.devicePixelRatio, scale);

      targetCanvas.width = Math.floor(viewport.width * outputScale);
      targetCanvas.height = Math.floor(viewport.height * outputScale);
      targetCanvas.style.width = `${Math.floor(viewport.width)}px`;
      targetCanvas.style.height = `${Math.floor(viewport.height)}px`;

      // En la versión 6 se dibuja pasando el canvas; `canvasContext` sigue aceptándose solo
      // por compatibilidad. El `transform` es lo que aprovecha los píxeles de más.
      renderTask = page.render({
        canvas: targetCanvas,
        transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
        viewport,
      });

      await renderTask.promise;
      if (cancelled) return;

      const { TextLayer } = await import("pdfjs-dist/legacy/build/pdf.mjs");
      if (cancelled) return;

      container.replaceChildren();
      textLayer = new TextLayer({
        container,
        textContentSource: page.streamTextContent(),
        viewport,
      });
      await textLayer.render();
      if (cancelled) return;
      markDrawn(true);
    }

    draw(canvas, textContainer).catch((error: unknown) => {
      // Cancelar un dibujo en curso es lo normal al cambiar de zoom o al alejarse: pdf.js
      // lo señala rechazando la promesa, y ahí no hay nada que reportar.
      if (cancelled) return;
      const name = error instanceof Error ? error.name : "";
      if (name === "RenderingCancelledException" || name === "AbortException") return;
      throw error;
    });

    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
    };
  }, [document, pageNumber, scale, shouldRender]);

  return (
    <div
      aria-label={`Página ${pageNumber} de ${title}`}
      className={styles.page}
      data-drawn="false"
      data-page-number={pageNumber}
      ref={frameRef}
      role="group"
      style={{
        "--scale-factor": scale,
        height: `${placement.height}px`,
        top: `${placement.top}px`,
        width: `${placement.width}px`,
      } as React.CSSProperties}
    >
      <canvas className={styles.canvas} ref={canvasRef} />
      <div
        className="textLayer"
        data-annotation-page={pageNumber}
        data-annotation-scope={`pdf-layer:${pageNumber}`}
        ref={textLayerRef}
      />
      {regions.map((region) => (
        <button
          aria-label={`Zona marcada${region.hasNote ? " con nota" : ""}`}
          className={styles.region}
          data-color={region.color}
          key={region.id}
          onClick={(event) => onRegionClick?.(region.id, event.currentTarget.getBoundingClientRect())}
          style={regionStyle(region.rect)}
          type="button"
        >
          {region.hasNote ? <span aria-hidden="true" className={styles.regionNote} /> : null}
        </button>
      ))}
      {crop ? <span aria-hidden="true" className={styles.cropBox} style={regionStyle(crop)} /> : null}
      <span aria-hidden="true" className={styles.pageNumber}>
        {pageNumber}
      </span>
    </div>
  );
});

function regionStyle(rect: NormalizedRect): React.CSSProperties {
  return {
    height: `${rect.height * 100}%`,
    left: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.width * 100}%`,
  };
}

/**
 * Dibuja solo una zona de la página, a una resolución pensada para compartir: unos 1600 px de
 * ancho, sea cual sea el zoom con el que se está leyendo.
 */
async function renderRegionImage(pdf: PdfDocument, pageNumber: number, rect: NormalizedRect) {
  const page = await pdf.getPage(pageNumber);
  try {
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(6, Math.max(1.5, 1600 / Math.max(1, rect.width * base.width)));
    const viewport = page.getViewport({ scale });
    const canvas = window.document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(rect.width * viewport.width));
    canvas.height = Math.max(1, Math.round(rect.height * viewport.height));
    await page.render({
      canvas,
      transform: [1, 0, 0, 1, -rect.x * viewport.width, -rect.y * viewport.height],
      viewport,
    }).promise;
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("No se pudo recortar la página."))), "image/png");
    });
  } finally {
    page.cleanup();
  }
}

/** El texto que cae dentro de una zona, en el orden del documento. Vacío en un escaneo. */
async function readRegionText(pdf: PdfDocument, pageNumber: number, rect: NormalizedRect) {
  const page = await pdf.getPage(pageNumber);
  try {
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const parts: string[] = [];
    for (const item of content.items as { height?: number; str?: string; transform?: number[]; width?: number }[]) {
      if (!item.str?.trim() || !item.transform) continue;
      const [x, y] = viewport.convertToViewportPoint(item.transform[4] ?? 0, item.transform[5] ?? 0);
      const centerX = ((x ?? 0) + (item.width ?? 0) / 2) / viewport.width;
      const centerY = ((y ?? 0) - (item.height ?? 0) / 2) / viewport.height;
      if (centerX >= rect.x && centerX <= rect.x + rect.width && centerY >= rect.y && centerY <= rect.y + rect.height) {
        parts.push(item.str);
      }
    }
    return parts
      .join(" ")
      .replaceAll(/\s+/g, " ")
      // «conoci- miento» al final de un renglón vuelve a ser «conocimiento».
      .replaceAll(/(\p{L})- (\p{Ll})/gu, "$1$2")
      .trim();
  } finally {
    page.cleanup();
  }
}

/** Lo que el lector puede pedir al visor sobre una zona de una página. */
export interface PdfRegionTools {
  readText: (page: number, rect: NormalizedRect) => Promise<string>;
  render: (page: number, rect: NormalizedRect) => Promise<Blob>;
}

/**
 * Modo lectura: el texto del documento recompuesto en el frame editorial del producto.
 *
 * Las páginas se recomponen por tandas a medida que se llega a ellas. Hacerlas todas al
 * abrir bloquearía el hilo de la interfaz durante segundos en un documento de doscientas
 * páginas, y quien entra aquí quiere empezar a leer, no esperar a que termine el archivo.
 */
function PdfReadingView({
  document: pdfDocument,
  initialPage,
  onPageChange,
  pageCount,
  title,
}: {
  document: PdfDocument;
  initialPage: number;
  onPageChange: (page: number) => void;
  pageCount: number;
  title: string;
}) {
  const [pages, setPages] = useState<ReflowedPage[]>([]);
  const [target, setTarget] = useState(() =>
    Math.min(pageCount, Math.max(reflowBatch, initialPage)),
  );
  const [failure, setFailure] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadedRef = useRef(0);
  const jumpedRef = useRef(false);

  const complete = pages.length >= pageCount;

  // ---- Recomposición por tandas --------------------------------------------
  useEffect(() => {
    if (loadedRef.current >= target || loadedRef.current >= pageCount) return;
    let cancelled = false;

    async function loadMore() {
      const from = loadedRef.current + 1;
      const to = Math.min(pageCount, target);
      const batch: ReflowedPage[] = [];

      for (let number = from; number <= to; number += 1) {
        const reflowed = await reflowDocumentPage(pdfDocument, number);
        if (cancelled) return;
        batch.push(reflowed);
      }

      loadedRef.current = to;
      setPages((current) => [...current, ...batch]);
    }

    loadMore().catch((error: unknown) => {
      if (cancelled) return;
      setFailure(error instanceof Error ? error.message : describePdfFailure(error));
    });

    return () => {
      cancelled = true;
    };
  }, [pageCount, pdfDocument, target]);

  // ---- Pedir más al acercarse al final -------------------------------------
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || complete) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setTarget((current) => Math.min(pageCount, current + reflowBatch));
        }
      },
      { rootMargin: "600px" },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [complete, pageCount, pages.length]);

  // ---- Qué página se está leyendo ------------------------------------------
  useEffect(() => {
    const container = sentinelRef.current?.parentElement;
    if (!container) return;

    const sections = [...container.querySelectorAll<HTMLElement>("[data-page]")];
    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // La sección que más superficie ocupa manda, igual que en el modo original.
        const best = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
        const page = Number(best?.target.getAttribute("data-page"));
        if (Number.isFinite(page) && page > 0) onPageChange(page);
      },
      { threshold: [0, 0.25, 0.5, 0.75] },
    );

    for (const section of sections) observer.observe(section);
    return () => observer.disconnect();
  }, [onPageChange, pages.length]);

  // ---- Llegar a la página con la que se entró ------------------------------
  useEffect(() => {
    if (jumpedRef.current || initialPage <= 1 || pages.length < initialPage) return;
    jumpedRef.current = true;
    const container = sentinelRef.current?.parentElement;
    container
      ?.querySelector(`[data-page="${initialPage}"]`)
      ?.scrollIntoView({ behavior: "auto", block: "start" });
  }, [initialPage, pages.length]);

  return (
    <article className={styles.reading}>
      {pages.map((page) => (
        <section
          aria-label={`Página ${page.number} de ${title}`}
          className={styles.readingPage}
          data-page={page.number}
          key={page.number}
        >
          <header className={styles.readingPageMark}>
            <span>Página {page.number}</span>
            {page.columns > 1 ? <span>Dos columnas</span> : null}
          </header>
          {page.blocks.length > 0 ? (
            <div data-annotation-page={page.number} data-annotation-scope={`pdf-reading:${page.number}`}>
              <ExtractedBlocks blocks={page.blocks} sectionTitle={`página ${page.number}`} />
            </div>
          ) : (
            <p className={styles.readingEmpty}>
              Esta página no tiene capa de texto: es una imagen a la espera del OCR. En
              «Original» se ve tal cual está en el documento.
            </p>
          )}
        </section>
      ))}

      <div className={styles.readingFoot} ref={sentinelRef}>
        {failure ? (
          <p role="alert">{failure}</p>
        ) : complete ? (
          <p>Fin del documento · {pageCount} páginas</p>
        ) : (
          <p role="status">
            Recomponiendo el texto… {pages.length} de {pageCount} páginas
          </p>
        )}
      </div>
    </article>
  );
}

export function PdfReader({
  blob,
  cropMode = false,
  initialPercent = 0,
  onCropModeChange,
  onError,
  onOutline,
  onPageChange,
  onProgressChange,
  onReady,
  onRegionClick,
  onRegionSelected,
  onRegionTools,
  pageRequest = null,
  pendingRegion = null,
  regions = noRegions,
  restartSignal = 0,
  resumeRequested = false,
  title,
}: PdfReaderProps) {
  // Zona que se está dibujando con el puntero, antes de soltarlo.
  const [draft, setDraft] = useState<{ page: number; rect: NormalizedRect } | null>(null);
  const cropStartRef = useRef<{ element: HTMLElement; page: number; x: number; y: number } | null>(null);
  const regionsByPage = useMemo(() => {
    const grouped = new Map<number, PdfRegionMark[]>();
    for (const region of regions) grouped.set(region.page, [...(grouped.get(region.page) ?? []), region]);
    return grouped;
  }, [regions]);
  const [state, setState] = useState<ReaderState>({ status: "loading" });
  const [availableWidth, setAvailableWidth] = useState(0);
  const [manualScale, setManualScale] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [range, setRange] = useState({ first: 0, last: 0 });
  const [mode, setMode] = useState<PdfViewMode>("original");
  // Página con la que entra el otro modo: se fija al cambiar y no se recalcula después,
  // porque cada modo lleva su propia cuenta mientras se lee.
  const [entryPage, setEntryPage] = useState(1);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const hasResumedRef = useRef(false);
  const lastReportedRef = useRef(-1);
  // Última página pedida, que no siempre es la que se está viendo: el desplazamiento tarda
  // en llegar, y sin esto tres pulsaciones seguidas de «siguiente» acabarían las tres en la
  // página dos.
  const requestedPageRef = useRef(1);
  // El modo lectura no tiene disposición de páginas de la que sacar el total.
  const pageCountRef = useRef(0);

  const sizes = state.status === "ready" ? state.sizes : null;

  // ---- Carga del documento -------------------------------------------------
  useEffect(() => {
    const signal = { cancelled: false };
    let close: (() => Promise<void>) | null = null;
    hasResumedRef.current = false;
    lastReportedRef.current = -1;

    async function load() {
      const buffer = await blob.arrayBuffer();
      if (signal.cancelled) return;
      // El reinicio va aquí y no en el cuerpo del efecto: al abrir otro documento hay que
      // volver a «cargando», pero hacerlo de forma síncrona encadenaría un render de más.
      setState({ status: "loading" });

      const opened = await openPdfDocument(new Uint8Array(buffer), "display");
      close = opened.close;
      if (signal.cancelled) {
        await opened.close();
        return;
      }

      const pageSizes = await readPageSizes(opened.document, signal);
      if (signal.cancelled) return;

      setState({ document: opened.document, sizes: pageSizes, status: "ready" });
    }

    load().catch((error: unknown) => {
      if (signal.cancelled) return;
      const message =
        error instanceof Error ? error.message : describePdfFailure(error);
      setState({ message, status: "error" });
      onError?.(message);
    });

    return () => {
      signal.cancelled = true;
      void close?.();
    };
    // `onError` se deja fuera a propósito: recrear el documento porque el padre cambió de
    // identidad supondría descargar y volver a analizar el archivo entero.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blob]);

  // ---- Ancho disponible ----------------------------------------------------
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      // Se descuenta el margen lateral para que la página no toque los bordes, y se pone
      // techo: a pantalla completa en un monitor ancho, «ajustar al ancho» llevaba la página
      // al 235 % y cada renglón pedía mover la cabeza. Más allá, el zoom es manual.
      setAvailableWidth(Math.min(comfortablePageWidth, Math.max(0, width - pageGap * 2)));
    });

    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  const fitScale = useMemo(
    () => (sizes && availableWidth > 0 ? fitToWidthScale(sizes, availableWidth) : 1),
    [availableWidth, sizes],
  );
  const scale = manualScale ?? fitScale;

  const placements = useMemo(
    () => (sizes ? placePages(sizes, scale) : []),
    [scale, sizes],
  );
  const pageCount = placements.length;
  const columnHeight = useMemo(() => totalHeight(placements), [placements]);

  useEffect(() => {
    pageCountRef.current = pageCount;
  }, [pageCount]);

  // ---- Desplazamiento: qué se ve y por dónde va la lectura -----------------
  const syncWithScroll = useCallback(() => {
    const scroller = scrollerRef.current;
    // En modo lectura la cuenta la lleva la vista recompuesta: sus secciones no guardan
    // relación con la disposición de páginas dibujadas.
    if (!scroller || placements.length === 0 || mode === "reading") return;

    const { clientHeight, scrollTop } = scroller;
    setRange(visiblePageRange(placements, scrollTop, clientHeight));

    const page = currentPageNumber(placements, scrollTop, clientHeight);
    setCurrentPage(page);
    requestedPageRef.current = page;

    const percent = pageProgressPercent(page, placements.length);
    if (percent !== lastReportedRef.current) {
      lastReportedRef.current = percent;
      onProgressChange?.(percent);
    }
  }, [mode, onProgressChange, placements]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || placements.length === 0) return;

    let frame = 0;
    function schedule() {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        syncWithScroll();
      });
    }

    // Al volver a la pestaña: mientras estuvo oculta el navegador congela
    // `requestAnimationFrame`, así que cualquier desplazamiento de ese rato quedó sin contar.
    function syncNow() {
      if (document.visibilityState === "visible") syncWithScroll();
    }

    schedule();
    scroller.addEventListener("scroll", schedule, { passive: true });
    document.addEventListener("visibilitychange", syncNow);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", schedule);
      document.removeEventListener("visibilitychange", syncNow);
    };
  }, [placements, syncWithScroll]);

  const goToPage = useCallback(
    (page: number, behavior: ScrollBehavior = "smooth") => {
      const scroller = scrollerRef.current;
      if (!scroller || placements.length === 0) return;
      const target = Math.min(placements.length, Math.max(1, page));
      // Quien ha pedido menos movimiento no debería recibir una página deslizándose: el
      // salto es instantáneo, igual que hace el resto de la interfaz.
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const applied = reducedMotion ? "auto" : behavior;
      requestedPageRef.current = target;

      if (mode === "reading") {
        // La vista recompuesta crece a medida que se lee: si esa página todavía no está
        // hecha no hay nada a lo que saltar, y la nota del pie dice por dónde va.
        scroller
          .querySelector(`[data-page="${target}"]`)
          ?.scrollIntoView({ behavior: applied, block: "start" });
        return;
      }

      scroller.scrollTo({ behavior: applied, top: scrollTopForPage(placements, target) });
    },
    [mode, placements],
  );

  /** Avanza o retrocede desde la última página pedida, no desde la que se ve. */
  const stepPage = useCallback(
    (delta: number) => goToPage(requestedPageRef.current + delta),
    [goToPage],
  );

  /** Cambia de modo sin perder el sitio: el otro abre por la página que se estaba leyendo. */
  const switchMode = useCallback(
    (next: PdfViewMode) => {
      // En el modo lectura no hay páginas dibujadas que recortar.
      if (next === "reading") onCropModeChange?.(false);
      setEntryPage(currentPage);
      setMode(next);
      if (next === "original") {
        // El desplazamiento se aplica cuando la columna ya está montada.
        window.requestAnimationFrame(() => goToPage(currentPage, "auto"));
      }
    },
    [currentPage, goToPage, onCropModeChange],
  );

  /** El modo lectura cuenta sus páginas por su cuenta; el avance se guarda igual. */
  const reportReadingPage = useCallback(
    (page: number) => {
      setCurrentPage(page);
      requestedPageRef.current = page;
      const percent = pageProgressPercent(page, pageCountRef.current);
      if (percent !== lastReportedRef.current) {
        lastReportedRef.current = percent;
        onProgressChange?.(percent);
      }
    },
    [onProgressChange],
  );

  // ---- Aviso de documento listo -------------------------------------------
  const documentReady = state.status === "ready" && placements.length > 0;

  useEffect(() => {
    if (!documentReady) return;
    onReady?.();
    // `onReady` fuera de las dependencias: es un aviso, no una entrada del cálculo, y un
    // padre que lo redefina en cada render no debe provocar avisos repetidos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentReady]);

  // ---- Retomar la lectura --------------------------------------------------
  useEffect(() => {
    // `initialPercent` puede llegar a cero en el primer render y subir cuando el
    // almacenamiento responde; por eso no se marca como retomado hasta que hay algo a lo
    // que volver, y `hasResumedRef` impide que el salto se repita después.
    if (!documentReady || hasResumedRef.current || !resumeRequested || initialPercent < 1) {
      return;
    }

    hasResumedRef.current = true;
    goToPage(pageFromProgressPercent(initialPercent, placements.length), "auto");
  }, [documentReady, goToPage, initialPercent, placements.length, resumeRequested]);

  // Referencia estable a la sincronización: la función cambia de identidad cada vez que se
  // recalcula la disposición, y meterla en las dependencias del reinicio haría que este
  // volviera a saltar a la primera página con cada zoom.
  const syncRef = useRef(syncWithScroll);
  useEffect(() => {
    syncRef.current = syncWithScroll;
  }, [syncWithScroll]);

  // ---- Volver al principio -------------------------------------------------
  useEffect(() => {
    if (restartSignal === 0) return;
    lastReportedRef.current = -1;
    goToPage(1);

    // Si ya se estaba en la primera página no hay desplazamiento que avise, y el avance se
    // quedaría en cero hasta que el lector moviera algo.
    const frame = window.requestAnimationFrame(() => syncRef.current());
    return () => window.cancelAnimationFrame(frame);
  }, [goToPage, restartSignal]);

  // ---- Página en curso hacia fuera ------------------------------------------
  const pageChangeRef = useRef(onPageChange);
  useEffect(() => {
    pageChangeRef.current = onPageChange;
  }, [onPageChange]);

  useEffect(() => {
    if (pageCount > 0) pageChangeRef.current?.(currentPage, pageCount);
  }, [currentPage, pageCount]);

  // ---- Saltos pedidos desde el índice --------------------------------------
  useEffect(() => {
    if (!pageRequest || !documentReady) return;
    goToPage(pageRequest.page);
    // Solo el `nonce` dispara el salto: `goToPage` cambia con cada zoom y no debe repetirlo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageRequest?.nonce, documentReady]);

  // ---- Marcadores del documento --------------------------------------------
  const outlineRef = useRef(onOutline);
  useEffect(() => {
    outlineRef.current = onOutline;
  }, [onOutline]);

  const loadedDocument = state.status === "ready" ? state.document : null;

  const regionToolsRef = useRef(onRegionTools);
  useEffect(() => {
    regionToolsRef.current = onRegionTools;
  }, [onRegionTools]);
  useEffect(() => {
    if (!loadedDocument) return;
    regionToolsRef.current?.({
      readText: (page, rect) => readRegionText(loadedDocument, page, rect),
      render: (page, rect) => renderRegionImage(loadedDocument, page, rect),
    });
    return () => regionToolsRef.current?.(null);
  }, [loadedDocument]);

  // ---- Recorte: arrastrar sobre una página -------------------------------------
  function cropPoint(element: HTMLElement, event: React.PointerEvent) {
    const rect = element.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  }

  function startCrop(event: React.PointerEvent<HTMLDivElement>) {
    if (!cropMode || event.button !== 0) return;
    const element = (event.target as HTMLElement).closest<HTMLElement>("[data-page-number]");
    if (!element) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const page = Number(element.dataset.pageNumber);
    const point = cropPoint(element, event);
    cropStartRef.current = { element, page, ...point };
    setDraft({ page, rect: { height: 0, width: 0, x: point.x, y: point.y } });
  }

  function moveCrop(event: React.PointerEvent<HTMLDivElement>) {
    const start = cropStartRef.current;
    if (!start) return;
    const point = cropPoint(start.element, event);
    setDraft({
      page: start.page,
      rect: {
        height: Math.abs(point.y - start.y),
        width: Math.abs(point.x - start.x),
        x: Math.min(point.x, start.x),
        y: Math.min(point.y, start.y),
      },
    });
  }

  function endCrop() {
    const start = cropStartRef.current;
    cropStartRef.current = null;
    const region = draft;
    setDraft(null);
    if (!start || !region) return;
    const pageRect = start.element.getBoundingClientRect();
    const width = region.rect.width * pageRect.width;
    const height = region.rect.height * pageRect.height;
    // Un toque o un arrastre mínimo no es un recorte.
    if (width < 16 || height < 16) return;
    onRegionSelected?.(
      region,
      new DOMRect(
        pageRect.left + region.rect.x * pageRect.width,
        pageRect.top + region.rect.y * pageRect.height,
        width,
        height,
      ),
    );
  }

  useEffect(() => {
    if (!cropMode) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCropModeChange?.(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cropMode, onCropModeChange]);

  useEffect(() => {
    if (!loadedDocument) return;
    let cancelled = false;
    void readPdfOutline(loadedDocument)
      .then((items) => {
        if (!cancelled) outlineRef.current?.(items);
      })
      .catch(() => {
        if (!cancelled) outlineRef.current?.([]);
      });
    return () => {
      cancelled = true;
    };
  }, [loadedDocument]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;

    if (event.key === "PageDown" || event.key === "ArrowRight") {
      event.preventDefault();
      stepPage(1);
    } else if (event.key === "PageUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      stepPage(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      goToPage(1);
    } else if (event.key === "End") {
      event.preventDefault();
      goToPage(pageCount);
    }
  }

  if (state.status === "error") {
    return (
      <div className={styles.reader}>
        <p className={styles.failure} role="alert">
          {state.message}
        </p>
      </div>
    );
  }

  const zoomPercent = Math.round(scale * 100);
  const usingFit = manualScale === null;
  const ready = state.status === "ready" && pageCount > 0;

  return (
    <div className={styles.reader}>
      <div className={styles.frame} ref={frameRef}>
        <div
          aria-label={`Páginas de ${title}`}
          className={styles.scroller}
          data-crop={cropMode && mode === "original" ? "true" : undefined}
          onKeyDown={handleKeyDown}
          ref={scrollerRef}
          role="document"
          tabIndex={0}
        >
          {state.status === "loading" ? (
            <p className={styles.loading} role="status">
              Preparando el documento en este dispositivo…
            </p>
          ) : mode === "reading" ? (
            <PdfReadingView
              document={state.document}
              initialPage={entryPage}
              key={`reading-${entryPage}`}
              onPageChange={reportReadingPage}
              pageCount={pageCount}
              title={title}
            />
          ) : (
            <div
              className={styles.column}
              onPointerCancel={endCrop}
              onPointerDown={startCrop}
              onPointerMove={moveCrop}
              onPointerUp={endCrop}
              style={{ height: `${columnHeight}px` }}
            >
              {placements.map((placement, index) => (
                <PdfPage
                  crop={
                    draft?.page === placement.number
                      ? draft.rect
                      : pendingRegion?.page === placement.number
                        ? pendingRegion.rect
                        : null
                  }
                  document={state.document}
                  key={placement.number}
                  onRegionClick={cropMode ? undefined : onRegionClick}
                  placement={placement}
                  regions={regionsByPage.get(placement.number) ?? noRegions}
                  scale={scale}
                  shouldRender={index >= range.first && index <= range.last}
                  title={title}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {cropMode && mode === "original" ? (
        <p className={styles.cropHint} role="status">
          <Icon name="crop" size={16} />
          Arrastra sobre la página para recortar · Esc para salir
        </p>
      ) : null}

      {/* Dock inferior, como en los lectores nativos: el pulgar llega, y la parte de arriba
          queda para el título. Se aparta junto con la barra superior al leer. */}
      <div aria-label="Controles del documento" className={styles.dock} role="toolbar">
        <div className={styles.scrubber}>
          <input
            aria-label="Desplazarse a una página"
            aria-valuetext={`Página ${currentPage} de ${pageCount}`}
            className={styles.scrubberInput}
            disabled={!ready}
            max={Math.max(1, pageCount)}
            min={1}
            onChange={(event) => goToPage(Number(event.target.value), "auto")}
            step={1}
            style={
              {
                "--scrub": pageCount > 1 ? (currentPage - 1) / (pageCount - 1) : 0,
              } as React.CSSProperties
            }
            type="range"
            value={currentPage}
          />
        </div>

        <div className={styles.dockRow}>
          <div className={styles.group}>
            <IconButton
              disabled={currentPage <= 1}
              icon="chevronLeft"
              label="Página anterior"
              onClick={() => stepPage(-1)}
              shortcut="←"
              size="sm"
            />
            <PageField
              currentPage={currentPage}
              disabled={!ready}
              onSubmit={(page) => goToPage(page)}
              pageCount={pageCount}
            />
            <IconButton
              disabled={!ready || currentPage >= pageCount}
              icon="chevronRight"
              label="Página siguiente"
              onClick={() => stepPage(1)}
              shortcut="→"
              size="sm"
            />
          </div>

          {/* Dos maneras de leer el mismo documento: fiel a la página o fiel al texto. */}
          <Segmented<PdfViewMode>
            label="Forma de leer"
            onChange={(next) => {
              if (sizes && next !== mode) switchMode(next);
            }}
            options={[
              { label: "Original", value: "original" },
              { label: "Lectura", value: "reading" },
            ]}
            size="sm"
            value={mode}
          />

          <div className={styles.group}>
            {mode === "original" && onCropModeChange ? (
              <IconButton
                aria-pressed={cropMode}
                disabled={!ready}
                icon="crop"
                label={cropMode ? "Salir del recorte" : "Recortar una zona"}
                onClick={() => onCropModeChange(!cropMode)}
                shortcut="R"
                size="sm"
                tone={cropMode ? "active" : "plain"}
              />
            ) : null}
            {mode === "original" ? (
              <Popover
                placement="above"
                title="Zoom"
                trigger={(props) => (
                  <button
                    {...props}
                    aria-label={`Zoom: ${zoomPercent} %`}
                    className={styles.zoomTrigger}
                    disabled={!sizes}
                    type="button"
                  >
                    {zoomPercent} %
                    <Icon name="chevronDown" size={14} />
                  </button>
                )}
                width={240}
              >
                <div className={styles.zoomPanel}>
                  <div className={styles.zoomStepper}>
                    <IconButton
                      icon="minus"
                      label="Reducir"
                      onClick={() =>
                        setManualScale((current) => nextZoomStep(current ?? fitScale, "out"))
                      }
                      size="sm"
                    />
                    <output>{zoomPercent} %</output>
                    <IconButton
                      icon="plus"
                      label="Ampliar"
                      onClick={() =>
                        setManualScale((current) => nextZoomStep(current ?? fitScale, "in"))
                      }
                      size="sm"
                    />
                  </div>
                  <button
                    aria-pressed={usingFit}
                    className={styles.zoomFit}
                    disabled={usingFit}
                    onClick={() => setManualScale(null)}
                    type="button"
                  >
                    <Icon name="measure" size={16} />
                    Ajustar al ancho
                  </button>
                </div>
              </Popover>
            ) : (
              <span className={styles.modeHint}>Texto recompuesto</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Número de página editable: escribir «37» e Intro lleva a la 37. En un documento largo,
 * saltar así es más rápido que cualquier barra.
 */
function PageField({
  currentPage,
  disabled,
  onSubmit,
  pageCount,
}: {
  currentPage: number;
  disabled: boolean;
  onSubmit: (page: number) => void;
  pageCount: number;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  function commit() {
    if (draft === null) return;
    const page = Number.parseInt(draft, 10);
    setDraft(null);
    if (Number.isFinite(page)) onSubmit(Math.min(pageCount, Math.max(1, page)));
  }

  return (
    <label className={styles.pageField}>
      <span className={styles.visuallyHidden}>Página actual</span>
      <input
        disabled={disabled}
        inputMode="numeric"
        onBlur={commit}
        onChange={(event) => setDraft(event.target.value.replace(/[^0-9]/g, ""))}
        onFocus={(event) => event.target.select()}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            setDraft(null);
            event.currentTarget.blur();
          }
        }}
        size={Math.max(2, String(pageCount).length)}
        value={draft ?? (disabled ? "–" : String(currentPage))}
      />
      <span aria-hidden="true">/ {pageCount || "–"}</span>
    </label>
  );
}

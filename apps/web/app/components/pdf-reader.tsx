"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@pliegue/ui";

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
import { describePdfFailure, openPdfDocument } from "../library/pdf-runtime";
import styles from "./pdf-reader.module.css";

type PdfDocument = Awaited<ReturnType<typeof openPdfDocument>>["document"];

/** Páginas cuyo tamaño se pide de una vez al abrir; evita miles de promesas simultáneas. */
const sizeBatch = 16;

type ReaderState =
  | { message: string; status: "error" }
  | { status: "loading" }
  | { document: PdfDocument; sizes: PdfPageSize[]; status: "ready" };

export interface PdfReaderProps {
  blob: Blob;
  /** Avance guardado, para retomar en la página que corresponda. */
  initialPercent?: number;
  onError?: (message: string) => void;
  /** Avance real, contado en páginas. Sustituye a la medición por desplazamiento. */
  onProgressChange?: (percent: number) => void;
  onReady?: () => void;
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

function PdfPage({
  document,
  placement,
  scale,
  shouldRender,
  title,
}: {
  document: PdfDocument;
  placement: PdfPagePlacement;
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
      <div className="textLayer" ref={textLayerRef} />
      <span aria-hidden="true" className={styles.pageNumber}>
        {pageNumber}
      </span>
    </div>
  );
}

export function PdfReader({
  blob,
  initialPercent = 0,
  onError,
  onProgressChange,
  onReady,
  restartSignal = 0,
  resumeRequested = false,
  title,
}: PdfReaderProps) {
  const [state, setState] = useState<ReaderState>({ status: "loading" });
  const [availableWidth, setAvailableWidth] = useState(0);
  const [manualScale, setManualScale] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [range, setRange] = useState({ first: 0, last: 0 });

  const scrollerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const hasResumedRef = useRef(false);
  const lastReportedRef = useRef(-1);
  // Última página pedida, que no siempre es la que se está viendo: el desplazamiento tarda
  // en llegar, y sin esto tres pulsaciones seguidas de «siguiente» acabarían las tres en la
  // página dos.
  const requestedPageRef = useRef(1);

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
      // Se descuenta el margen lateral para que la página no toque los bordes.
      setAvailableWidth(Math.max(0, width - pageGap * 2));
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

  // ---- Desplazamiento: qué se ve y por dónde va la lectura -----------------
  const syncWithScroll = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller || placements.length === 0) return;

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
  }, [onProgressChange, placements]);

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
      requestedPageRef.current = target;
      scroller.scrollTo({
        behavior: reducedMotion ? "auto" : behavior,
        top: scrollTopForPage(placements, target),
      });
    },
    [placements],
  );

  /** Avanza o retrocede desde la última página pedida, no desde la que se ve. */
  const stepPage = useCallback(
    (delta: number) => goToPage(requestedPageRef.current + delta),
    [goToPage],
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

  return (
    <div className={styles.reader}>
      <div className={styles.toolbar}>
        <div className={styles.group}>
          <Button
            aria-label="Página anterior"
            disabled={currentPage <= 1}
            onClick={() => stepPage(-1)}
            size="sm"
            variant="quiet"
          >
            ←
          </Button>
          <span aria-live="polite" className={styles.pageStatus}>
            {state.status === "ready" && pageCount > 0 ? (
              <>
                <strong>{currentPage}</strong> / {pageCount}
              </>
            ) : (
              "Cargando…"
            )}
          </span>
          <Button
            aria-label="Página siguiente"
            disabled={pageCount === 0 || currentPage >= pageCount}
            onClick={() => stepPage(1)}
            size="sm"
            variant="quiet"
          >
            →
          </Button>
        </div>

        <div className={styles.group}>
          <Button
            aria-label="Reducir"
            disabled={!sizes}
            onClick={() => setManualScale((current) => nextZoomStep(current ?? fitScale, "out"))}
            size="sm"
            variant="quiet"
          >
            −
          </Button>
          <span className={styles.zoomStatus}>{zoomPercent} %</span>
          <Button
            aria-label="Ampliar"
            disabled={!sizes}
            onClick={() => setManualScale((current) => nextZoomStep(current ?? fitScale, "in"))}
            size="sm"
            variant="quiet"
          >
            +
          </Button>
          <Button
            aria-pressed={usingFit}
            disabled={!sizes || usingFit}
            onClick={() => setManualScale(null)}
            size="sm"
            variant={usingFit ? "secondary" : "quiet"}
          >
            Ajustar ancho
          </Button>
        </div>
      </div>

      <div className={styles.frame} ref={frameRef}>
        <div
          aria-label={`Páginas de ${title}`}
          className={styles.scroller}
          onKeyDown={handleKeyDown}
          ref={scrollerRef}
          role="document"
          tabIndex={0}
        >
          {state.status === "loading" ? (
            <p className={styles.loading} role="status">
              Preparando el documento en este dispositivo…
            </p>
          ) : (
            <div className={styles.column} style={{ height: `${columnHeight}px` }}>
              {placements.map((placement, index) => (
                <PdfPage
                  document={state.document}
                  key={placement.number}
                  placement={placement}
                  scale={scale}
                  shouldRender={index >= range.first && index <= range.last}
                  title={title}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

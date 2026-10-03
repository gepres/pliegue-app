"use client";

import { useEffect, useRef, useState } from "react";

import { dimLayer, focusBandHeights, toneLayersFor, type FocusSize } from "../../preferences/reading-filter";
import { useReadingFilter } from "../../preferences/reading-filter-store";
import styles from "./reader.module.css";

/**
 * El enfoque de lectura: dos franjas oscuras dejan a la vista una banda que sigue al puntero (o
 * al dedo: se coloca donde se toca). Hasta el primer movimiento, la banda está a un 40 % de la
 * altura, solo con CSS. No recibe clics: se sigue seleccionando, marcando y desplazando debajo.
 */
function FocusMask({ size }: { size: Exclude<FocusSize, "off"> }) {
  const [pointerY, setPointerY] = useState<number | null>(null);
  const frame = useRef(0);
  const height = focusBandHeights[size];

  useEffect(() => {
    function follow(event: PointerEvent) {
      // Con el dedo, la banda va donde se toca; arrastrar desplaza la página, no la banda.
      if (event.pointerType !== "mouse" && event.type === "pointermove") return;
      const y = event.clientY;
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => setPointerY(y));
    }
    window.addEventListener("pointermove", follow, { passive: true });
    window.addEventListener("pointerdown", follow, { passive: true });
    return () => {
      window.removeEventListener("pointermove", follow);
      window.removeEventListener("pointerdown", follow);
      cancelAnimationFrame(frame.current);
    };
  }, []);

  const center = pointerY === null ? "40vh" : `${pointerY}px`;
  // Sin salirse de la pantalla: la banda nunca empieza por encima de 0 ni acaba por debajo del alto.
  const top = `clamp(0px, calc(${center} - ${height / 2}px), calc(100dvh - ${height}px))`;
  return (
    <>
      <div aria-hidden="true" className={styles.focusMask} data-focus-edge="top" style={{ height: top, top: 0 }} />
      <div aria-hidden="true" className={styles.focusMask} data-focus-edge="bottom" style={{ bottom: 0, top: `calc(${top} + ${height}px)` }} />
    </>
  );
}

/**
 * Las capas del filtro de lectura, entre la página y las barras del lector: tiñen y atenúan lo
 * que se lee —también un PDF escaneado— sin tocar los mandos. El modo noche del PDF no va aquí:
 * es un filtro sobre el dibujo de cada página (`data-pdf-night` en el lector).
 */
export function ReadingFilterLayer() {
  const filter = useReadingFilter();
  const tones = toneLayersFor(filter);
  const dim = dimLayer(filter);
  return (
    <>
      {tones.map((layer) => (
        <div
          aria-hidden="true"
          className={styles.toneLayer}
          data-tone={filter.tone}
          key={layer.blend}
          style={{ background: layer.background, mixBlendMode: layer.blend, opacity: layer.opacity }}
        />
      ))}
      {dim ? <div aria-hidden="true" className={styles.dimLayer} style={{ opacity: dim.opacity }} /> : null}
      {filter.focus !== "off" ? <FocusMask size={filter.focus} /> : null}
    </>
  );
}

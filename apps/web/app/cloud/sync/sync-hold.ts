/**
 * Pausa la sincronización mientras otra parte de la app deja el estado a medias.
 *
 * Al escanear una carpeta, un libro movido cambia de identificador y su estado (avance, notas,
 * favorito) se traslada al nuevo. Una vuelta que cayera en medio vería el libro sin su estado y
 * lo tomaría por borrado. Quien escanea retiene la sincronización; al soltarla, se sincroniza.
 *
 * Sin dependencias a propósito: lo usa la biblioteca sin arrastrar el cliente de la nube.
 */
let holds = 0;
const releaseListeners = new Set<() => void>();

/** Retiene la sincronización hasta llamar a la función devuelta (una sola vez cuenta). */
export function holdSync(): () => void {
  holds += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds -= 1;
    if (holds === 0) for (const listener of releaseListeners) listener();
  };
}

export function isSyncHeld() {
  return holds > 0;
}

/** Avisa cuando se suelta la última retención. */
export function onSyncReleased(listener: () => void) {
  releaseListeners.add(listener);
  return () => {
    releaseListeners.delete(listener);
  };
}

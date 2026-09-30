import {
  hashText,
  planTranslationQueue,
  translationPercent,
  type TranslatedBlock,
} from "./translation";
import { translateBlocks, type OpenTranslator } from "./translation-engine";

/**
 * Una sesión de traducción de un libro: la cola, lo ya traducido y el avance.
 *
 * Mientras se lee, traduce primero la unidad que se está mirando y después las siguientes,
 * de una en una. Lo que ya estaba guardado se reutiliza si el texto del original no cambió;
 * si cambió, se vuelve a traducir. No sabe nada de React ni de IndexedDB: recibe cómo leer
 * una unidad y dónde guardarla, y avisa a quien se suscriba cada vez que algo cambia.
 */

export interface SourceUnit<Block extends { text: string }> {
  blocks: Block[];
}

export interface TranslatedUnit<Block extends { text: string }> {
  source: Block[];
  translated: TranslatedBlock[];
}

export interface TranslationStorage {
  read: (unitId: string) => Promise<TranslatedBlock[] | null>;
  write: (unitId: string, blocks: TranslatedBlock[]) => Promise<void>;
}

export interface TranslationSessionOptions<Block extends { text: string }> {
  loadUnit: (unit: number) => Promise<SourceUnit<Block>>;
  pagesAhead: number;
  /** Unidades que ya estaban traducidas y guardadas al empezar: cuentan para el avance. */
  storedIds: ReadonlySet<string>;
  storage: TranslationStorage;
  translator: OpenTranslator;
  unitCount: number;
  unitId: (unit: number) => string;
}

export interface TranslationSnapshot {
  /** Unidades traducidas del libro, guardadas en el dispositivo. */
  done: number;
  error: string | null;
  failed: ReadonlySet<number>;
  /** Las que esperan turno, sin contar la que se está traduciendo. */
  pending: readonly number[];
  percent: number;
  /** Cambia con cada novedad: sirve para volver a pintar. */
  version: number;
  working: number | null;
}

/** Tras tantos fallos seguidos el motor está roto: se para en vez de insistir sin fin. */
const maxConsecutiveFailures = 3;

export class TranslationSession<Block extends { text: string }> {
  private current = 1;
  private readonly units = new Map<number, TranslatedUnit<Block>>();
  private readonly storedIds: Set<string>;
  private readonly failed = new Set<number>();
  private readonly listeners = new Set<() => void>();
  private readonly abort = new AbortController();
  private consecutiveFailures = 0;
  private running = false;
  private working: number | null = null;
  private error: string | null = null;
  private snapshot: TranslationSnapshot;

  constructor(private readonly options: TranslationSessionOptions<Block>) {
    this.storedIds = new Set(options.storedIds);
    this.snapshot = this.buildSnapshot(0);
  }

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = () => this.snapshot;

  unit(unit: number) {
    return this.units.get(unit);
  }

  /** La unidad que se está leyendo: la cola se rehace a partir de ella. */
  setCurrent(unit: number) {
    this.current = Math.min(Math.max(1, unit), Math.max(1, this.options.unitCount));
    this.publish();
    void this.pump();
  }

  /** Vuelve a intentar las unidades que fallaron. */
  retry() {
    this.failed.clear();
    this.consecutiveFailures = 0;
    this.error = null;
    this.publish();
    void this.pump();
  }

  dispose() {
    this.abort.abort();
    this.listeners.clear();
    this.options.translator.destroy();
  }

  private plan() {
    const skip = new Set<number>([...this.units.keys(), ...this.failed]);
    if (this.working !== null) skip.add(this.working);
    return planTranslationQueue(this.current, this.options.unitCount, this.options.pagesAhead, skip);
  }

  private buildSnapshot(version: number): TranslationSnapshot {
    return {
      done: this.storedIds.size,
      error: this.error,
      failed: new Set(this.failed),
      pending: this.plan(),
      percent: translationPercent(this.storedIds.size, this.options.unitCount),
      version,
      working: this.working,
    };
  }

  private publish() {
    this.snapshot = this.buildSnapshot(this.snapshot.version + 1);
    for (const listener of this.listeners) listener();
  }

  private async pump() {
    if (this.running) return;
    this.running = true;
    try {
      while (!this.abort.signal.aborted && this.error === null) {
        const next = this.plan()[0];
        if (next === undefined) break;
        this.working = next;
        this.publish();
        await this.translateUnit(next);
        this.working = null;
        this.publish();
      }
    } finally {
      this.running = false;
    }
  }

  private async translateUnit(unit: number) {
    const { loadUnit, storage, translator, unitId } = this.options;
    const id = unitId(unit);
    try {
      const source = await loadUnit(unit);
      const stored = this.storedIds.has(id) ? await storage.read(id) : null;
      const reusable =
        stored !== null &&
        stored.length === source.blocks.length &&
        stored.every((block, index) => block.hash === hashText(source.blocks[index]?.text ?? ""));
      const translated = reusable
        ? stored
        : await translateBlocks(translator, source.blocks.map((block) => block.text), this.abort.signal);
      if (!reusable) await storage.write(id, translated);
      if (this.abort.signal.aborted) return;
      this.units.set(unit, { source: source.blocks, translated });
      this.storedIds.add(id);
      this.consecutiveFailures = 0;
    } catch (error) {
      if (this.abort.signal.aborted) return;
      this.failed.add(unit);
      this.consecutiveFailures += 1;
      if (this.consecutiveFailures >= maxConsecutiveFailures) {
        this.error = error instanceof Error && error.message ? error.message : "El traductor dejó de responder.";
      }
    }
  }
}

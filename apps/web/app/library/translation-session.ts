import {
  planTranslationQueue,
  translationPercent,
  type TranslatedBlock,
} from "./translation";
import { translateBlocks, type OpenTranslator } from "./translation-engine";
import { glossaryHash, type GlossaryEntry } from "./translation-glossary";

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
  /**
   * Antes de pedir una unidad al traductor; si lanza, la sesión se para ahí (04.6: el tope del
   * presupuesto). Va antes de la unidad y no dentro: lo que está en marcha termina entero.
   */
  gate?: () => void;
  /** El glosario vigente del libro; se lee al traducir cada unidad. */
  glossary?: () => readonly GlossaryEntry[];
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
  /** Se paró por el tope del presupuesto de IA: se puede seguir con este libro a conciencia. */
  budget: boolean;
  /** Unidades traducidas del libro, guardadas en el dispositivo. */
  done: number;
  error: string | null;
  failed: ReadonlySet<number>;
  /** Las que esperan turno, sin contar la que se está traduciendo. */
  pending: readonly number[];
  percent: number;
  /** Se traduce el libro entero, no solo lo que va por delante de la lectura. */
  whole: boolean;
  /** Cambia con cada novedad: sirve para volver a pintar. */
  version: number;
  working: number | null;
}

/** Tras tantos fallos seguidos el motor está roto: se para en vez de insistir sin fin. */
const maxConsecutiveFailures = 3;

export class TranslationSession<Block extends { text: string }> {
  private current = 1;
  private readonly units = new Map<number, TranslatedUnit<Block>>();
  /** Traducidas con un glosario que ya cambió: se siguen viendo hasta que se rehacen. */
  private readonly stale = new Set<number>();
  private readonly storedIds: Set<string>;
  private readonly failed = new Set<number>();
  private readonly listeners = new Set<() => void>();
  private readonly abort = new AbortController();
  private consecutiveFailures = 0;
  private running = false;
  private whole = false;
  private working: number | null = null;
  private error: string | null = null;
  private budget = false;
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

  /**
   * El glosario cambió: las unidades ya traducidas se repasan —primero la que se lee— y solo
   * se vuelven a traducir los bloques donde aparece un término que cambió.
   */
  refreshGlossary() {
    for (const unit of this.units.keys()) this.stale.add(unit);
    this.publish();
    void this.pump();
  }

  /**
   * Traduce el libro entero en segundo plano (05.5): primero, como siempre, lo que se lee y lo que
   * va por delante; después, el resto, desde ahí hasta el final y luego desde el principio. Lo ya
   * guardado no se vuelve a pedir.
   */
  translateAll() {
    this.whole = true;
    this.publish();
    void this.pump();
  }

  /** Vuelve a traducir solo lo que va por delante de la lectura; lo hecho se queda. */
  stopWhole() {
    this.whole = false;
    this.publish();
  }

  /** Cuánto falta por traducir del libro: unidades y, estimados por lo ya visto, caracteres. */
  remaining() {
    const units = Math.max(0, this.options.unitCount - this.storedIds.size);
    const seen = [...this.units.values()].map((unit) => unit.source.reduce((sum, block) => sum + block.text.length, 0));
    const average = seen.length ? seen.reduce((sum, value) => sum + value, 0) / seen.length : 0;
    return { characters: Math.round(units * average), units };
  }

  /** Vuelve a intentar las unidades que fallaron. */
  retry() {
    this.failed.clear();
    this.consecutiveFailures = 0;
    this.error = null;
    this.budget = false;
    this.publish();
    void this.pump();
  }

  dispose() {
    this.abort.abort();
    this.listeners.clear();
    this.options.translator.destroy();
  }

  private plan() {
    const skip = new Set<number>([...[...this.units.keys()].filter((unit) => !this.stale.has(unit)), ...this.failed]);
    if (this.working !== null) skip.add(this.working);
    const near = planTranslationQueue(this.current, this.options.unitCount, this.options.pagesAhead, skip);
    if (!this.whole) return near;
    const total = this.options.unitCount;
    const queued = new Set(near);
    const rest: number[] = [];
    for (let offset = 0; offset < total; offset += 1) {
      const unit = ((this.current - 1 + offset) % total) + 1;
      if (skip.has(unit) || queued.has(unit) || this.storedIds.has(this.options.unitId(unit))) continue;
      rest.push(unit);
    }
    return [...near, ...rest];
  }

  private buildSnapshot(version: number): TranslationSnapshot {
    return {
      budget: this.budget,
      done: this.storedIds.size,
      error: this.error,
      failed: new Set(this.failed),
      // Parada (un error o el tope del presupuesto), no hay nada en cola: si no, el lector decía
      // «Traduciendo esta sección…» en las que no se iban a traducir.
      pending: this.error === null ? this.plan() : [],
      percent: translationPercent(this.storedIds.size, this.options.unitCount),
      version,
      whole: this.whole,
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
      const glossary = this.options.glossary?.() ?? [];
      const texts = source.blocks.map((block) => block.text);
      const expected = texts.map((text) => glossaryHash(text, glossary));
      const stored = this.storedIds.has(id) ? await storage.read(id) : null;
      // Se reutiliza bloque a bloque: con la misma extracción, solo se traduce lo que cambió
      // (un término del glosario corregido); si la extracción es otra, todo.
      const sameShape = stored !== null && stored.length === texts.length;
      const missing = texts.flatMap((_, index) => (sameShape && stored[index]?.hash === expected[index] ? [] : [index]));
      let translated = sameShape ? stored : [];
      if (missing.length > 0) {
        this.options.gate?.();
        const fresh = await translateBlocks(translator, missing.map((index) => texts[index] ?? ""), this.abort.signal, glossary);
        translated = texts.map((_, index) => {
          const position = missing.indexOf(index);
          return position === -1 ? stored![index]! : fresh[position]!;
        });
        await storage.write(id, translated);
      }
      if (this.abort.signal.aborted) return;
      this.stale.delete(unit);
      this.units.set(unit, { source: source.blocks, translated });
      this.storedIds.add(id);
      this.consecutiveFailures = 0;
    } catch (error) {
      if (this.abort.signal.aborted) return;
      this.failed.add(unit);
      // El tope del presupuesto para en seco: insistir no cambia nada.
      if (error instanceof Error && error.name === "BudgetExceededError") {
        this.error = error.message;
        this.budget = true;
        return;
      }
      this.consecutiveFailures += 1;
      if (this.consecutiveFailures >= maxConsecutiveFailures) {
        this.error = error instanceof Error && error.message ? error.message : "El traductor dejó de responder.";
      }
    }
  }
}

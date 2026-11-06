import { describe, expect, it } from "vitest";

import type { LibraryDocument } from "../../library/documents";
import { translatedUnitKey, type TranslatedUnitRecord } from "../../library/translation-store";
import { indexLibraryKeys } from "./document-key";
import {
  buildTranslationFile,
  pairRef,
  parseTranslationFile,
  transferTranslations,
  translationFileMaxBytes,
  translationItemKey,
  translationObjectPath,
  translationQuotaBytes,
  type TranslationCloudState,
  type TranslationStateStore,
  type TranslationStorage,
  type TranslationUnits,
} from "./translation-files";

const userId = "u-1";
const pairId = "browser:en>es";
const now = new Date("2026-11-06T12:00:00.000Z");
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();

function book(id: string, name = "Morel.pdf"): LibraryDocument {
  return {
    author: "",
    availability: "available",
    format: "pdf",
    id,
    meta: "",
    origin: "local",
    originalName: name,
    reference: { kind: "local-file", referenceId: id },
    sizeBytes: 1000,
    tags: [],
    title: name,
  } as LibraryDocument;
}

/** El bucket en memoria. */
function memoryStorage() {
  const objects = new Map<string, string>();
  const storage: TranslationStorage = {
    async download(path) {
      const text = objects.get(path);
      if (text === undefined) throw new Error("Object not found");
      return text;
    },
    async upload(path, json) {
      objects.set(path, json);
    },
  };
  return { objects, storage };
}

/** Un equipo: sus traducciones (como IndexedDB, sin pisar lo que ya hay) y lo que recuerda de la nube. */
function device(documentId: string) {
  const records = new Map<string, TranslatedUnitRecord>();
  let state: TranslationCloudState = { cloud: {}, held: {} };
  const units: TranslationUnits = {
    async merge(incoming) {
      let written = 0;
      for (const record of incoming) {
        if (records.has(record.key)) continue;
        records.set(record.key, record);
        written += 1;
      }
      return written;
    },
    async pairs() {
      return [...new Set([...records.values()].map((record) => pairRef(record.documentId, record.pairId)))].map((ref) => {
        const [document, pair] = JSON.parse(ref) as [string, string];
        return { documentId: document, pairId: pair };
      });
    },
    async read(document, pair) {
      return [...records.values()].filter((record) => record.documentId === document && record.pairId === pair);
    },
  };
  const store: TranslationStateStore = {
    load: () => structuredClone(state),
    save: (next) => {
      state = structuredClone(next);
    },
  };
  return {
    documentId,
    records,
    get state() {
      return state;
    },
    set state(next: TranslationCloudState) {
      state = next;
    },
    store,
    translate(unitId: string, text: string, translatedAt = minutesAgo(10)) {
      records.set(translatedUnitKey(documentId, pairId, unitId), {
        blocks: [{ hash: `h-${unitId}`, text }],
        documentId,
        key: translatedUnitKey(documentId, pairId, unitId),
        pairId,
        translatedAt,
        unitId,
      });
    },
    async transfer(storage: TranslationStorage, at = now, dirty: ReadonlySet<string> | null = null) {
      return transferTranslations({
        dirty,
        keys: await indexLibraryKeys([book(documentId)]),
        now: at,
        state: store,
        storage,
        units,
        userId,
      });
    },
    texts() {
      return Object.fromEntries([...records.values()].map((record) => [record.unitId, record.blocks[0]?.text]));
    },
  };
}

/** Lo que la fusión de `sync_items` haría llegar a otro equipo: el índice de la nube. */
function shareIndex(from: ReturnType<typeof device>, to: ReturnType<typeof device>) {
  to.state = { cloud: structuredClone(from.state.cloud), held: to.state.held };
}

describe("archivo de una traducción", () => {
  it("la huella es del texto traducido: la fecha de cada página no la cambia", () => {
    const record = (translatedAt: string): TranslatedUnitRecord => ({
      blocks: [{ hash: "a", text: "Hola" }],
      documentId: "d",
      key: "k",
      pairId,
      translatedAt,
      unitId: "page:1",
    });
    expect(buildTranslationFile(pairId, [record(minutesAgo(1))]).hash).toBe(buildTranslationFile(pairId, [record(minutesAgo(90))]).hash);
  });

  it("descarta entero un archivo que no tiene la forma esperada", () => {
    expect(parseTranslationFile("{")).toBeNull();
    expect(parseTranslationFile(JSON.stringify({ pairId, schemaVersion: 2, units: [] }))).toBeNull();
    expect(parseTranslationFile(JSON.stringify({ pairId, schemaVersion: 1, units: [{ blocks: [{ text: 1 }], translatedAt: "", unitId: "x" }] }))).toBeNull();
  });

  it("un archivo por libro, idioma y par: la ruta empieza por la cuenta y dice el idioma", () => {
    const key = translationItemKey("abc", "ai:openai:gpt-4.1-mini:en>es");
    expect(key).toMatch(/^abc\/es\.[a-z0-9]+$/);
    expect(key).not.toBe(translationItemKey("abc", pairId));
    expect(translationObjectPath(userId, key)).toBe(`${userId}/${key}.json`);
  });
});

describe("subir las traducciones de este equipo", () => {
  it("sube una traducción quieta, la apunta en el índice y no la vuelve a subir", async () => {
    const { objects, storage } = memoryStorage();
    const pc = device("pc-1");
    pc.translate("page:1", "Hola");
    pc.translate("page:2", "Mundo");

    const first = await pc.transfer(storage);
    expect(first.uploaded).toBe(1);
    const [path] = [...objects.keys()];
    expect(path).toMatch(new RegExp(`^${userId}/[0-9a-f]{64}/es\\.[a-z0-9]+\\.json$`));
    const [itemKey] = Object.keys(pc.state.cloud);
    expect(pc.state.cloud[itemKey!]).toMatchObject({ pairId, size: objects.get(path!)!.length });
    expect(first.cloudFiles).toBe(1);

    expect((await pc.transfer(storage)).uploaded).toBe(0);
  });

  it("no sube lo que se está traduciendo: espera a que lleve 2 minutos quieto", async () => {
    const { storage } = memoryStorage();
    const pc = device("pc-1");
    pc.translate("page:1", "Hola", minutesAgo(0.5));
    const result = await pc.transfer(storage);
    expect(result.uploaded).toBe(0);
    expect([...result.later]).toEqual([pairRef("pc-1", pairId)]);
    // En la vuelta de dentro de 3 minutos, ya sí.
    expect((await pc.transfer(storage, new Date(now.getTime() + 3 * 60_000), result.later)).uploaded).toBe(1);
  });

  it("no sube más de 5 MB por archivo ni pasa del cupo de la cuenta", async () => {
    const { objects, storage } = memoryStorage();
    const big = device("pc-1");
    big.translate("page:1", "x".repeat(translationFileMaxBytes));
    const tooBig = await big.transfer(storage);
    expect(tooBig.uploaded).toBe(0);
    expect(tooBig.skipped).toMatchObject([{ reason: "size" }]);

    const full = device("pc-2");
    full.translate("page:1", "x".repeat(1024 * 1024));
    full.state = { cloud: { "otro/es.x": { hash: "h", pairId, size: translationQuotaBytes - 512 * 1024, updatedAt: minutesAgo(60) } }, held: {} };
    const noRoom = await full.transfer(storage);
    expect(noRoom.skipped).toMatchObject([{ reason: "quota" }]);
    expect(objects.size).toBe(0);
  });
});

describe("dos equipos con el mismo libro", () => {
  it("el otro equipo baja la traducción sin traducir nada", async () => {
    const { storage } = memoryStorage();
    const pc = device("pc-1");
    pc.translate("page:1", "Hola");
    pc.translate("page:2", "Mundo");
    await pc.transfer(storage);

    const laptop = device("lap-9");
    shareIndex(pc, laptop);
    const result = await laptop.transfer(storage);
    expect(result.downloaded).toBe(1);
    expect(result.uploaded).toBe(0);
    expect(laptop.texts()).toEqual({ "page:1": "Hola", "page:2": "Mundo" });
    // Ya al día: la siguiente vuelta no baja nada.
    expect((await laptop.transfer(storage)).downloaded).toBe(0);
  });

  it("lo de cada equipo no se pisa, lo que falta se junta y no se pisan en cada vuelta", async () => {
    const { storage } = memoryStorage();
    const pc = device("pc-1");
    pc.translate("page:1", "Hola");
    pc.translate("page:2", "Mundo (PC)");
    await pc.transfer(storage);

    // El portátil tradujo antes, por su cuenta, la página 2 con otro texto y la 3.
    const laptop = device("lap-9");
    laptop.translate("page:2", "Mundo (portátil)", minutesAgo(30));
    laptop.translate("page:3", "Adiós", minutesAgo(30));
    shareIndex(pc, laptop);
    const merged = await laptop.transfer(storage);
    expect(merged).toMatchObject({ downloaded: 1, uploaded: 1 });
    expect(laptop.texts()).toEqual({ "page:1": "Hola", "page:2": "Mundo (portátil)", "page:3": "Adiós" });

    // El PC baja lo junto: gana la página 3 y conserva su página 2. No vuelve a subir.
    shareIndex(laptop, pc);
    const back = await pc.transfer(storage, new Date(now.getTime() + 60_000));
    expect(back).toMatchObject({ downloaded: 1, uploaded: 0 });
    expect(pc.texts()).toEqual({ "page:1": "Hola", "page:2": "Mundo (PC)", "page:3": "Adiós" });

    // Y el portátil tampoco: están al día aunque su página 2 sea distinta.
    expect(await laptop.transfer(storage, new Date(now.getTime() + 120_000))).toMatchObject({ downloaded: 0, uploaded: 0 });
  });

  it("lo traducido aquí después de la última subida sí sube", async () => {
    const { storage } = memoryStorage();
    const pc = device("pc-1");
    pc.translate("page:1", "Hola");
    await pc.transfer(storage);
    pc.translate("page:2", "Mundo", new Date(now.getTime() + 10 * 60_000).toISOString());
    const later = new Date(now.getTime() + 60 * 60_000);
    expect((await pc.transfer(storage, later, new Set([pairRef("pc-1", pairId)]))).uploaded).toBe(1);
  });

  it("un libro que no está en este equipo no se baja, pero cuenta para el cupo", async () => {
    const { storage } = memoryStorage();
    const pc = device("pc-1");
    pc.translate("page:1", "Hola");
    await pc.transfer(storage);

    const phone = device("tel-1");
    phone.state = { cloud: Object.fromEntries(Object.entries(pc.state.cloud).map(([key, value]) => [`otro-libro/${key.split("/")[1]}`, value])), held: {} };
    const result = await phone.transfer(storage);
    expect(result).toMatchObject({ cloudFiles: 1, downloaded: 0 });
    expect(result.cloudBytes).toBeGreaterThan(0);
  });
});

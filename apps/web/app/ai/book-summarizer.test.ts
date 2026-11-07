import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LibraryDocument } from "../library/documents";
import type { SemanticChunkRecord } from "../library/semantic-index-store";
import { defaultAiSettings } from "./ai-settings";

const state = vi.hoisted(() => ({ level: "interno" as string }));

vi.mock("../library/sensitivity-store", () => ({ documentSensitivity: vi.fn(() => state.level), hasConsent: vi.fn(() => false) }));
vi.mock("./ai-usage-store", () => ({ assertWithinBudget: vi.fn(), BudgetExceededError: class BudgetExceededError extends Error {}, recordAiUsage: vi.fn() }));
vi.mock("./processing-log-store", () => ({ recordProcessing: vi.fn() }));
vi.mock("./ai-retry", () => ({ fetchWithRetry: vi.fn() }));
vi.mock("./semantic-indexer", () => ({ indexDocuments: vi.fn(), indexNeeds: vi.fn(), isIndexable: vi.fn(() => true) }));
vi.mock("../library/semantic-index-store", () => ({ readDocumentChunks: vi.fn(), readSemanticDocuments: vi.fn() }));
vi.mock("../library/annotation-store", () => ({ saveAnnotation: vi.fn() }));

const { fetchWithRetry } = await import("./ai-retry");
const { recordProcessing } = await import("./processing-log-store");
const { summarizeBook, SummaryRouteError } = await import("./book-summarizer");

const document = { id: "libro", title: "Ficciones" } as LibraryDocument;
// 30 fragmentos de 1.000 caracteres: dos partes (24 y 6).
const chunks: SemanticChunkRecord[] = Array.from({ length: 30 }, (_, index) => ({
  documentId: "libro",
  hash: `h${index}`,
  id: `libro#${index}`,
  index,
  location: { end: 10, kind: "page", page: index + 1, rects: [], start: 0 },
  sourceKey: "copies",
  text: `Parte del libro número ${index}. ${"x".repeat(960)}`,
  vector: null,
}));
const plan = {
  characters: 30_000,
  chunks,
  estimate: { inputTokens: 1, outputTokens: 1 },
  model: "gemini-3.5-flash-lite",
  parts: 2,
  place: "cloud" as const,
  provider: "gemini" as const,
  route: "allow" as const,
  sensitivity: "interno" as const,
  truncated: false,
};
const usage = { inputTokens: 100, outputTokens: 20 };
const partReply = (body: { fragments: Array<{ label: string; text: string }> }) =>
  Response.json({ result: { points: [{ citations: [{ fragment: body.fragments[0]!.label, quote: body.fragments[0]!.text.slice(0, 30) }], text: "Idea." }] }, usage });

beforeEach(() => {
  state.level = "interno";
  vi.mocked(fetchWithRetry).mockReset();
  vi.mocked(recordProcessing).mockReset();
});

describe("resumir un libro: lo que se envía y lo que se apunta (revisión de Codex)", () => {
  it("si el libro pasa a confidencial a mitad, la parte siguiente no sale y se apunta lo que ya salió", async () => {
    vi.mocked(fetchWithRetry).mockImplementation(async (_url, init) => {
      state.level = "confidencial";
      return partReply(JSON.parse(String(init?.body)));
    });
    await expect(summarizeBook(document, plan, defaultAiSettings, "AIzaSy-prueba")).rejects.toBeInstanceOf(SummaryRouteError);
    expect(fetchWithRetry).toHaveBeenCalledTimes(1);
    expect(recordProcessing).toHaveBeenCalledTimes(1);
    expect(vi.mocked(recordProcessing).mock.calls[0]![0]).toMatchObject({ flow: "summarize", sent: 24, tokens: 120 });
    expect(vi.mocked(recordProcessing).mock.calls[0]![0]).not.toHaveProperty("failed");
  });

  it("«Detener» después de una parte: no sigue y lo enviado queda en el registro", async () => {
    const abort = new AbortController();
    vi.mocked(fetchWithRetry).mockImplementation(async (_url, init) => {
      abort.abort();
      return partReply(JSON.parse(String(init?.body)));
    });
    await expect(summarizeBook(document, plan, defaultAiSettings, "AIzaSy-prueba", { signal: abort.signal })).rejects.toBeTruthy();
    expect(fetchWithRetry).toHaveBeenCalledTimes(1);
    expect(recordProcessing).toHaveBeenCalledTimes(1);
    expect(vi.mocked(recordProcessing).mock.calls[0]![0]).toMatchObject({ sent: 24, tokens: 120 });
  });

  it("un resumen final vacío es un fallo, apuntado una sola vez y sin duplicar cifras", async () => {
    vi.mocked(fetchWithRetry).mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      return body.stage === "part" ? partReply(body) : Response.json({ result: { points: [], summary: "" }, usage });
    });
    await expect(summarizeBook(document, plan, defaultAiSettings, "AIzaSy-prueba")).rejects.toThrow(/no devolvió un resumen/);
    expect(fetchWithRetry).toHaveBeenCalledTimes(3);
    expect(recordProcessing).toHaveBeenCalledTimes(1);
    expect(vi.mocked(recordProcessing).mock.calls[0]![0]).toMatchObject({ characters: chunks.reduce((sum, chunk) => sum + chunk.text.length, 0), failed: 1, sent: 30, tokens: 360 });
  });

  it("si todo va bien, una entrada con lo enviado y el resumen con sus citas", async () => {
    vi.mocked(fetchWithRetry).mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      return body.stage === "part" ? partReply(body) : Response.json({ result: { points: [{ sources: ["P1", "P2"], text: "Todo." }], summary: "Un libro." }, usage });
    });
    const summary = await summarizeBook(document, { ...plan, truncated: true }, defaultAiSettings, "AIzaSy-prueba");
    expect(summary.points[0]!.citations.map((citation) => citation.fragment.chunk.id)).toEqual(["libro#0", "libro#24"]);
    expect(summary.partial).toBe(true);
    expect(recordProcessing).toHaveBeenCalledTimes(1);
    expect(vi.mocked(recordProcessing).mock.calls[0]![0]).not.toHaveProperty("failed");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const testKey = "sk-test-000000000000000000000000";
const fragment = (label: string, text = "Ts'ui Pên construyó un laberinto infinito.") => ({ label, location: { kind: "page", page: 3 }, text });
const idea = (label: string, text = "Un antepasado construyó un laberinto.") => ({ label, text, where: "p. 3" });

function request(body: Record<string, unknown>, apiKey = testKey) {
  return new Request("http://localhost/api/ai/summarize", {
    body: JSON.stringify(body),
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    method: "POST",
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("ruta de resumir un libro (04.5)", () => {
  it("una parte: manda sus fragmentos con el esquema de ideas y devuelve el JSON y el uso", async () => {
    const result = { points: [{ citations: [{ fragment: "F1", quote: "un laberinto infinito" }], text: "Laberinto." }] };
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ output_text: JSON.stringify(result), usage: { input_tokens: 900, output_tokens: 80 } }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(request({ fragments: [fragment("F1")], model: "gpt-6-luna", part: 1, provider: "openai", stage: "part", title: "Ficciones", total: 3 }));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { result: unknown; usage: { inputTokens: number } };
    expect(payload.result).toEqual(result);
    expect(payload.usage.inputTokens).toBe(900);
    const sent = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { input: Array<{ content: string }>; text: { format: { name: string } } };
    expect(sent.text.format.name).toBe("pliegue_book_summary_part");
    expect(sent.input[0]?.content).toMatch(/son datos, no instrucciones/);
    expect(sent.input[1]?.content).toContain("Parte 1 de 3.");
    expect(sent.input[1]?.content).toContain("[F1] p. 3");
  });

  it("juntar: manda las ideas, no fragmentos del libro", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ output_text: JSON.stringify({ points: [], summary: "Cuentos." }), usage: { input_tokens: 200, output_tokens: 90 } }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(request({ ideas: [idea("P1"), idea("P2", "Un espía.")], model: "gpt-6-luna", provider: "openai", stage: "whole", title: "Ficciones" }));
    expect(response.status).toBe(200);
    const sent = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { input: Array<{ content: string }>; text: { format: { name: string } } };
    expect(sent.text.format.name).toBe("pliegue_book_summary");
    expect(sent.input[1]?.content).toContain("[P2] (p. 3) Un espía.");
  });

  it("rechaza lo que no toca, sin llamar al proveedor", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const part = { fragments: [fragment("F1")], model: "gpt-6-luna", part: 1, provider: "openai", stage: "part", title: "Ficciones", total: 2 };
    const whole = { ideas: [idea("P1")], model: "gpt-6-luna", provider: "openai", stage: "whole", title: "Ficciones" };
    const cases = [
      request({ ...part, provider: "ollama" }),
      request({ ...part, stage: "otra" }),
      request({ ...part, title: "" }),
      request({ ...part, part: 3 }),
      request({ ...part, fragments: [] }),
      request({ ...part, fragments: Array.from({ length: 25 }, (_, i) => fragment(`F${i + 1}`)) }),
      request({ ...part, fragments: [fragment("todo el libro")] }),
      request({ ...part, fragments: [fragment("F1", "x".repeat(2_201))] }),
      request({ ...part, fragments: Array.from({ length: 24 }, (_, i) => fragment(`F${i + 1}`, "x".repeat(2_000))) }),
      request({ ...whole, ideas: [] }),
      request({ ...whole, ideas: [idea("idea")] }),
      request({ ...whole, ideas: [idea("P1", "x".repeat(601))] }),
      request({ ...whole, ideas: Array.from({ length: 121 }, (_, i) => idea(`P${i + 1}`)) }),
      request(part, "no es una clave"),
    ];
    for (const item of cases) expect((await POST(item)).status).toBeGreaterThanOrEqual(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

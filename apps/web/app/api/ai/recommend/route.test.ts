import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const testKey = "sk-test-000000000000000000000000";

function request(body: Record<string, unknown>, apiKey = testKey) {
  return new Request("http://localhost/api/ai/recommend", {
    body: JSON.stringify(body),
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    method: "POST",
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("ruta de afinar con IA (06.1)", () => {
  it("manda los gustos con el esquema de sugerencias y devuelve el JSON y el uso", async () => {
    const result = { suggestions: [{ author: "Isabel Allende", reason: "Realismo mágico.", title: "La casa de los espíritus" }] };
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ output_text: JSON.stringify(result), usage: { input_tokens: 120, output_tokens: 60 } }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(request({ authors: ["Julio Cortázar"], model: "gpt-6-luna", provider: "openai", subjects: ["Realismo mágico"] }));
    expect(response.status).toBe(200);
    expect(((await response.json()) as { result: unknown }).result).toEqual(result);
    const sent = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { input: Array<{ content: string }>; text: { format: { name: string } } };
    expect(sent.text.format.name).toBe("pliegue_book_suggestions");
    expect(sent.input[1]?.content).toContain("Julio Cortázar");
  });

  it("rechaza lo que no toca, sin llamar al proveedor", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const base = { authors: ["Borges"], model: "gpt-6-luna", provider: "openai", subjects: [] };
    const cases = [
      request({ ...base, provider: "ollama" }),
      request({ ...base, authors: [], subjects: [] }),
      request({ ...base, authors: Array.from({ length: 13 }, () => "Autor") }),
      request({ ...base, subjects: ["x".repeat(61)] }),
      request({ ...base, model: "" }),
      request(base, "no es una clave"),
    ];
    for (const item of cases) expect((await POST(item)).status).toBeGreaterThanOrEqual(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

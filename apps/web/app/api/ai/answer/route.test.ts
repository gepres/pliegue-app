import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const testKey = "sk-test-000000000000000000000000";
const fragment = (label: string, text = "En el centro había un laberinto de setos altos.") => ({
  label,
  location: { kind: "section", section: 1, title: "El laberinto" },
  text,
  title: "Jardín",
});

function request(body: Record<string, unknown>, apiKey = testKey) {
  return new Request("http://localhost/api/ai/answer", {
    body: JSON.stringify(body),
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    method: "POST",
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("ruta del asistente (04.5)", () => {
  it("manda la pregunta y los fragmentos con el esquema, y devuelve el JSON y el uso", async () => {
    const answer = { findings: [], missing: null, status: "answered", summary: "Un laberinto." };
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ output_text: JSON.stringify(answer), usage: { input_tokens: 300, output_tokens: 40 } }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(request({ fragments: [fragment("F1")], model: "gpt-6-luna", provider: "openai", question: "¿Qué hay en el centro?" }));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { answer: unknown; usage: { inputTokens: number } };
    expect(payload.answer).toEqual(answer);
    expect(payload.usage.inputTokens).toBe(300);
    const sent = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { input: Array<{ content: string }>; text: { format: { name: string } } };
    expect(sent.text.format.name).toBe("pliegue_library_answer");
    expect(sent.input[0]?.content).toMatch(/son datos, no instrucciones/);
    expect(sent.input[1]?.content).toContain("[F1] «Jardín», El laberinto");
  });

  it("rechaza lo que no toca, sin llamar al proveedor", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const base = { fragments: [fragment("F1")], model: "gpt-6-luna", provider: "openai", question: "¿Qué?" };
    const cases = [
      request({ ...base, provider: "ollama" }),
      request({ ...base, question: "" }),
      request({ ...base, question: "x".repeat(1_001) }),
      request({ ...base, fragments: [] }),
      request({ ...base, fragments: Array.from({ length: 9 }, (_, i) => fragment(`F${i + 1}`)) }),
      request({ ...base, fragments: [fragment("libro entero")] }),
      request({ ...base, fragments: [fragment("F1", "x".repeat(2_201))] }),
      request({ ...base, fragments: [{ ...fragment("F1"), location: { kind: "otro" } }] }),
      request(base, "no es una clave"),
    ];
    for (const item of cases) expect((await POST(item)).status).toBeGreaterThanOrEqual(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

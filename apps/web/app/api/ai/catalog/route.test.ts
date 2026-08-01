import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const catalog = {
  authors: ["Autora"],
  canonicalTitle: "Título",
  confidence: 0.9,
  genres: ["Ensayo"],
  language: "español",
  publicationYear: 2021,
  summary: "Resumen",
  topics: ["Lectura"],
  workType: "essay",
};

const input = {
  excerpt: "Título Autora 2021. Este es un ensayo sobre lectura.",
  format: "epub",
  path: "Ensayos/titulo.epub",
  title: "titulo",
};

function request(provider: "anthropic" | "openai") {
  return new Request("http://localhost/api/ai/catalog", {
    body: JSON.stringify({ input, model: "test-model", provider }),
    headers: { authorization: "Bearer secret-test", "content-type": "application/json" },
    method: "POST",
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("catalog provider route", () => {
  it("usa Responses con esquema estricto y no incluye la clave en el cuerpo", async () => {
    const providerFetch = vi.fn().mockResolvedValue(
      Response.json({
        output: [{ content: [{ text: JSON.stringify(catalog), type: "output_text" }] }],
      }),
    );
    vi.stubGlobal("fetch", providerFetch);

    const response = await POST(request("openai"));
    const [, options] = providerFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(providerFetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/responses",
      expect.any(Object),
    );
    expect(body).toMatchObject({
      model: "test-model",
      store: false,
      text: { format: { strict: true, type: "json_schema" } },
    });
    expect(options.body).not.toContain("secret-test");
    expect((options.headers as Record<string, string>).authorization).toBe(
      "Bearer secret-test",
    );
  });

  it("envía a Anthropic la salida estructurada y la clave en x-api-key", async () => {
    const providerFetch = vi.fn().mockResolvedValue(
      Response.json({ content: [{ text: JSON.stringify(catalog), type: "text" }] }),
    );
    vi.stubGlobal("fetch", providerFetch);

    const response = await POST(request("anthropic"));
    const [, options] = providerFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(providerFetch).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/messages",
      expect.any(Object),
    );
    expect(body).toMatchObject({
      model: "test-model",
      output_config: { format: { type: "json_schema" } },
    });
    expect(options.body).not.toContain("secret-test");
    expect((options.headers as Record<string, string>)["x-api-key"]).toBe("secret-test");
  });
});

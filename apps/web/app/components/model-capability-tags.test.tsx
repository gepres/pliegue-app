import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ModelCapabilityTags } from "./model-capability-tags";

describe("etiquetas de capacidades del modelo", () => {
  it("muestra capacidades, contexto y límite de salida con la cifra exacta en el título", () => {
    const html = renderToStaticMarkup(<ModelCapabilityTags capabilities={{
      structuredOutput: true, vision: true, embeddings: false, contextTokens: 128_000, maxOutputTokens: 32_768,
    }} />);
    expect(html).toContain("Salida JSON</span>");
    expect(html).toContain("Imágenes</span>");
    expect(html).toContain("Embeddings: no");
    expect(html).toContain("Contexto 128 k");
    expect(html).toContain("Salida máxima 32,8 k");
    expect(html).toContain('title="32.768 tokens"');
    expect(html).not.toContain('role="alert"');
  });

  it("avisa de que catalogar y traducir no funcionarán y permite guardar", () => {
    const html = renderToStaticMarkup(<ModelCapabilityTags capabilities={{ structuredOutput: false, vision: false, embeddings: true }} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Catalogar y traducir con IA no funcionarán");
    expect(html).toContain("Puedes guardar los ajustes igualmente.");
    expect(html).toContain("Embeddings</span>");
  });

  it("distingue lo desconocido de lo incompatible y omite límites no disponibles", () => {
    const html = renderToStaticMarkup(<ModelCapabilityTags capabilities={{
      structuredOutput: "desconocido", vision: "desconocido", embeddings: "desconocido",
    }} />);
    expect(html).toContain("Salida JSON: sin confirmar");
    expect(html).toContain("Imágenes: sin confirmar");
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("Contexto");
    expect(html).not.toContain("Salida máxima");
  });
});

import type { Metadata } from "next";

import { SourcesOverview } from "../../../../components/sources/sources-overview";

export const metadata: Metadata = {
  title: "Fuentes",
  description: "De dónde salen los documentos de la Biblioteca, cómo están organizados y qué falta.",
};

export default function SourcesPage() {
  return <SourcesOverview />;
}

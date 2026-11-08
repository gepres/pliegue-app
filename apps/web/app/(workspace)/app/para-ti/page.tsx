import type { Metadata } from "next";

import { ForYou } from "../../../components/books/for-you";
import { PageHeader } from "../../../components/workspace-page";

export const metadata: Metadata = {
  title: "Para ti",
  description: "Libros recomendados según tus gustos, con el porqué de cada uno y dónde conseguirlos.",
};

export default function ForYouPage() {
  return (
    <>
      <PageHeader
        description="Libros que pueden gustarte, cada uno con el porqué y dónde conseguirlo. Tú eliges con qué se recomienda, y lo puedes borrar cuando quieras."
        eyebrow="Recomendaciones"
        title="Para ti"
      />
      <ForYou />
    </>
  );
}

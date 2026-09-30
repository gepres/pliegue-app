import { describe, expect, it } from "vitest";

import { groundCatalogExtras } from "./catalog-grounding";
import { spanishCategory } from "./category-names";
import { emptyCatalogExtras } from "./document-catalog";

const morel = [
  "Adolfo Bioy Casares. La invención de Morel. Prólogo de Jorge Luis Borges.",
  "EMECÉ EDITORES, S. A. Buenos Aires. Colección Novelistas de Nuestra Época.",
  "ISBN 950-04-0203-6. Segunda edición. Otras obras del autor, completas en esta colección.",
].join(" ");

describe("cotejo de los datos de la edición", () => {
  it("conserva lo que está en el texto, con otra grafía o con guiones en el ISBN", () => {
    const grounded = groundCatalogExtras(
      {
        ...emptyCatalogExtras,
        category: "Literatura",
        edition: "Segunda edición",
        isbn: "9500402036",
        publisher: "Emecé Editores",
        series: "Novelistas de nuestra época",
        volume: 3,
      },
      morel,
      "La invención de Morel",
    );

    expect(grounded).toMatchObject({
      category: "Literatura",
      edition: "Segunda edición",
      isbn: "9500402036",
      publisher: "Emecé Editores",
      series: "Novelistas de nuestra época",
      volume: 3,
    });
  });

  it("descarta lo que el modelo inventó: ISBN, editorial, tomo sin serie y un prologuista como traductor", () => {
    const grounded = groundCatalogExtras(
      {
        ...emptyCatalogExtras,
        editors: ["Jorge Luis Borges"],
        isbn: "9788400000000",
        originalTitle: "La invención de Morel",
        publisher: "Penguin Books",
        // «obras» y «completas» están en el texto, pero no seguidas.
        series: "Obras Completas",
        translators: ["Jorge Luis Borges"],
        volume: 1,
      },
      morel,
      "La invención de Morel",
    );

    expect(grounded).toEqual(emptyCatalogExtras);
  });

  it("acepta al traductor cuando el texto dice que tradujo", () => {
    const grounded = groundCatalogExtras(
      { ...emptyCatalogExtras, originalTitle: "Braiding Sweetgrass", translators: ["Luis Murillo Fort"] },
      "Una trenza de hierba sagrada. Título original: Braiding Sweetgrass. Traducción de Luis Murillo Fort.",
      "Una trenza de hierba sagrada",
    );
    expect(grounded.translators).toEqual(["Luis Murillo Fort"]);
    expect(grounded.originalTitle).toBe("Braiding Sweetgrass");
  });
});

describe("categorías en español", () => {
  it("pasa al español las materias que llegan en inglés y deja las demás", () => {
    expect(spanishCategory({ category: "Literary", subcategory: "Short Story" })).toEqual({
      category: "Literatura",
      subcategory: "Cuento",
    });
    expect(spanishCategory({ category: "spiritual", subcategory: null })).toEqual({
      category: "Religión y espiritualidad",
      subcategory: null,
    });
    expect(spanishCategory({ category: "Historia", subcategory: "Historia del Perú" })).toEqual({
      category: "Historia",
      subcategory: "Historia del Perú",
    });
    // «Literature › Literary» no deja la misma materia dos veces.
    expect(spanishCategory({ category: "Literature", subcategory: "Literary" })).toEqual({
      category: "Literatura",
      subcategory: null,
    });
  });
});

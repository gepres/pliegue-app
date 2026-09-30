import { describe, expect, it } from "vitest";

import { CategoryIndex } from "./category-names";

describe("vocabulario de categorías", () => {
  it("conserva la primera grafía y reescribe con ella las variantes de mayúsculas y acentos", () => {
    const index = new CategoryIndex();
    expect(index.add("Filosofía", "Estoicismo")).toEqual({ category: "Filosofía", subcategory: "Estoicismo" });
    expect(index.add(" filosofia ", "ESTOICISMO")).toEqual({ category: "Filosofía", subcategory: "Estoicismo" });
    expect(index.add("Historia")).toEqual({ category: "Historia", subcategory: null });
    expect(index.size).toBe(2);
  });

  it("no une materias distintas aunque una contenga a la otra", () => {
    const index = new CategoryIndex();
    index.add("Historia");
    expect(index.add("Historia del arte").category).toBe("Historia del arte");
    expect(index.size).toBe(2);
  });

  it("presenta el vocabulario para el prompt con cada subcategoría bajo su materia", () => {
    const index = new CategoryIndex();
    index.add("Historia", "Historia del Perú");
    index.add("Historia", "Historia antigua");
    index.add("Literatura");
    index.add(null, "Suelta");
    expect(index.entries).toEqual([
      "Historia › Historia del Perú",
      "Historia › Historia antigua",
      "Literatura",
    ]);
  });
});

import { describe, expect, it } from "vitest";

import {
  AuthorIndex,
  authorKey,
  isSameAuthor,
  preferAuthorName,
  reconcileAuthors,
} from "./author-names";

describe("igualdad de autores", () => {
  it("une la forma corta con la larga cuando comparten apellido", () => {
    expect(isSameAuthor("Jacobo Grinberg", "Jacobo Grinberg Zylberbaum")).toBe(true);
    expect(isSameAuthor("Cristina Sánchez", "Cristina Sánchez Muñoz")).toBe(true);
  });

  it("trata el guion de un apellido compuesto como un espacio", () => {
    expect(isSameAuthor("Jacobo Grinberg-Zylberbaum", "Jacobo Grinberg Zylberbaum")).toBe(true);
    expect(isSameAuthor("Juan-Eduardo Cirlot", "Juan Eduardo Cirlot")).toBe(true);
  });

  it("resuelve las iniciales contra el nombre desarrollado", () => {
    expect(isSameAuthor("J. L. Rodríguez García", "José Luis Rodríguez García")).toBe(true);
  });

  it("ignora acentos y mayúsculas", () => {
    expect(isSameAuthor("MARIA JOSE GUERRA PALMERO", "María José Guerra Palmero")).toBe(true);
  });

  it("no une a dos personas que solo comparten el nombre de pila", () => {
    expect(isSameAuthor("Carlos Castaneda", "Carlos Fernández Liria")).toBe(false);
    expect(isSameAuthor("Isra García", "Pepe García")).toBe(false);
    expect(isSameAuthor("Miguel Morey", "Miguel García-Baró")).toBe(false);
    expect(isSameAuthor("Marco Aurelio", "Marco Tulio Cicerón")).toBe(false);
    expect(isSameAuthor("Stephen Hanselman", "Stephen Mace")).toBe(false);
    expect(isSameAuthor("Ramón Bayés", "Ramón del Castillo")).toBe(false);
  });

  it("no une a dos personas que solo comparten el apellido", () => {
    expect(isSameAuthor("Gregory Lopez", "Gerardo López Sastre")).toBe(false);
    expect(isSameAuthor("Martín Sevilla Rodríguez", "José Luis Rodríguez García")).toBe(false);
  });

  it("exige coincidencia exacta cuando el nombre es de una sola palabra", () => {
    expect(isSameAuthor("Anónimo", "anonimo")).toBe(true);
    expect(isSameAuthor("Anónimo", "Anónimo el Joven")).toBe(false);
  });

  it("no compara por parecido: un error tipográfico sigue siendo otro autor", () => {
    expect(isSameAuthor("Henry Brune", "Henri Brunel")).toBe(false);
  });
});

describe("forma canónica", () => {
  it("prefiere el nombre que desarrolla las iniciales", () => {
    expect(preferAuthorName("J. L. Rodríguez García", "José Luis Rodríguez García")).toBe(
      "José Luis Rodríguez García",
    );
  });

  it("prefiere el nombre que añade apellidos", () => {
    expect(preferAuthorName("Cristina Sánchez", "Cristina Sánchez Muñoz")).toBe(
      "Cristina Sánchez Muñoz",
    );
  });

  it("no depende del orden en que lleguen los nombres", () => {
    expect(preferAuthorName("Jacobo Grinberg", "Jacobo Grinberg-Zylberbaum")).toBe(
      preferAuthorName("Jacobo Grinberg-Zylberbaum", "Jacobo Grinberg"),
    );
  });

  it("normaliza la clave de igualdad", () => {
    expect(authorKey("Grinberg-Zylberbaum, J.")).toBe("grinberg zylberbaum j");
  });
});

describe("índice de autores conocidos", () => {
  it("devuelve la grafía ya establecida para una variante nueva", () => {
    const index = new AuthorIndex(["Jacobo Grinberg-Zylberbaum"]);
    expect(index.resolve("Jacobo Grinberg")).toBe("Jacobo Grinberg-Zylberbaum");
  });

  it("mejora la forma canónica cuando llega una más completa", () => {
    const index = new AuthorIndex(["Cristina Sánchez"]);
    expect(index.add("Cristina Sánchez Muñoz")).toBe("Cristina Sánchez Muñoz");
    expect(index.names).toEqual(["Cristina Sánchez Muñoz"]);
  });

  it("mantiene separados a los autores distintos", () => {
    const index = new AuthorIndex(["Carlos Castaneda"]);
    index.add("Carlos Fernández Liria");
    expect(index.names).toHaveLength(2);
  });

  it("deja intacto el nombre que no conoce", () => {
    expect(new AuthorIndex(["Marco Aurelio"]).resolve("Séneca")).toBe("Séneca");
  });
});

describe("reconciliación de una ficha", () => {
  it("adopta la grafía del catálogo en lugar de abrir una entrada paralela", () => {
    expect(reconcileAuthors(["Jacobo Grinberg"], ["Jacobo Grinberg-Zylberbaum"])).toEqual([
      "Jacobo Grinberg-Zylberbaum",
    ]);
  });

  it("unifica dos variantes que llegan en la misma ficha", () => {
    expect(reconcileAuthors(["Jacobo Grinberg", "Jacobo Grinberg Zylberbaum"])).toEqual([
      "Jacobo Grinberg Zylberbaum",
    ]);
  });

  it("conserva el orden y a los coautores distintos", () => {
    expect(
      reconcileAuthors(["Ryan Holiday", "Stephen Hanselman"], ["Ryan Holiday"]),
    ).toEqual(["Ryan Holiday", "Stephen Hanselman"]);
  });

  it("no inventa autores cuando la lista está vacía", () => {
    expect(reconcileAuthors([], ["Marco Aurelio"])).toEqual([]);
  });
});

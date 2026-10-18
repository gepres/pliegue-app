import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { isReportReason, reportReasons } from "./report-reasons";

describe("motivos de una denuncia", () => {
  it("reconoce los suyos y nada más", () => {
    expect(isReportReason("derechos")).toBe(true);
    expect(isReportReason("toString")).toBe(false);
    expect(isReportReason(1)).toBe(false);
  });

  it("son los mismos que acepta la base", () => {
    const migration = readFileSync(new URL("../../../../supabase/migrations/20261018150000_moderacion_bibliotecas.sql", import.meta.url), "utf8");
    const allowed = /library_reports_reason check \(reason in \(([^)]+)\)\)/.exec(migration)?.[1] ?? "";
    expect(allowed.split(",").map((value) => value.trim().replaceAll("'", "")).sort()).toEqual(Object.keys(reportReasons).sort());
  });
});

import { describe, expect, it } from "vitest";

import { normalizeAccessCode } from "./access-session";
import {
  accessLink,
  codeStatus,
  dateInputValue,
  describeBrowser,
  endOfDay,
  parseMaxUses,
  returningEntries,
  suggestAccessCode,
  summarizeCodes,
  type AccessCodeRow,
  type AccessEventRow,
} from "./admin-summary";

const now = Date.parse("2026-10-03T12:00:00.000Z");

function code(partial: Partial<AccessCodeRow>): AccessCodeRow {
  return { active: true, code: "OCT2026AREQUIPA", created_at: "2026-10-01T00:00:00.000Z", expires_at: null, id: "c1", label: "", max_uses: null, uses: 0, ...partial };
}

function event(partial: Partial<AccessEventRow>): AccessEventRow {
  return { code_id: "c1", created_at: "2026-10-02T10:00:00.000Z", device_id: "d1", id: 1, user_agent: "", visitor_name: "Ana", ...partial };
}

describe("panel de la biblioteca general", () => {
  it("dice el estado de cada código", () => {
    expect(codeStatus(code({}), now)).toBe("active");
    expect(codeStatus(code({ active: false }), now)).toBe("disabled");
    expect(codeStatus(code({ expires_at: "2026-10-03T11:59:00.000Z" }), now)).toBe("expired");
    expect(codeStatus(code({ max_uses: 2, uses: 2 }), now)).toBe("exhausted");
    expect(codeStatus(code({ max_uses: 2, uses: 1 }), now)).toBe("active");
  });

  it("resume usos por código: equipos y personas distintas, y la última entrada", () => {
    const summaries = summarizeCodes(
      [code({ id: "c1" }), code({ code: "OTRO", id: "c2" })],
      [
        event({ created_at: "2026-10-02T10:00:00.000Z", device_id: "d1", visitor_name: "Ana" }),
        event({ created_at: "2026-10-03T09:00:00.000Z", device_id: "d1", id: 2, visitor_name: " ana " }),
        event({ created_at: "2026-10-02T12:00:00.000Z", device_id: "d2", id: 3, visitor_name: "Luis" }),
      ],
    );
    expect(summaries.get("c1")).toEqual({ devices: 2, entries: 3, lastEntry: "2026-10-03T09:00:00.000Z", people: 2 });
    expect(summaries.get("c2")).toEqual({ devices: 0, entries: 0, lastEntry: null, people: 0 });
  });

  it("reconoce el navegador y el sistema", () => {
    expect(describeBrowser("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36")).toBe("Chrome en Windows");
    expect(describeBrowser("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")).toBe("Safari en iPhone");
    expect(describeBrowser("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Edg/140.0")).toBe("Edge en Windows");
    expect(describeBrowser("Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36")).toBe("Chrome en Android");
    expect(describeBrowser("")).toBe("Navegador desconocido");
  });

  it("propone códigos válidos, con lugar o al azar, y el enlace para compartirlos", () => {
    const october = new Date(2026, 9, 3);
    expect(suggestAccessCode(october, "Arequipa")).toBe("OCT2026AREQUIPA");
    expect(suggestAccessCode(october, "  Cusco – Taller ñ ")).toBe("OCT2026CUSCOTALLERN");
    const random = suggestAccessCode(october, "", () => 0);
    expect(random).toBe("OCT2026-AAAA");
    for (let attempt = 0; attempt < 20; attempt += 1) expect(normalizeAccessCode(suggestAccessCode(october))).not.toBeNull();
    expect(accessLink("https://pliegue.genaropretill.com/", "OCT2026AREQUIPA")).toBe("https://pliegue.genaropretill.com/biblioteca/general/OCT2026AREQUIPA");
  });
  it("marca como vuelta a quien ya entró con el mismo código, equipo y nombre", () => {
    const returning = returningEntries([
      event({ created_at: "2026-10-02T10:00:00.000Z", device_id: "d1", id: 1, visitor_name: "Ana" }),
      event({ created_at: "2026-10-03T10:00:00.000Z", device_id: "d1", id: 4, visitor_name: " ANA " }),
      event({ created_at: "2026-10-02T11:00:00.000Z", device_id: "d2", id: 2, visitor_name: "Ana" }),
      event({ code_id: "c2", created_at: "2026-10-02T12:00:00.000Z", device_id: "d1", id: 3, visitor_name: "Ana" }),
    ]);
    expect([...returning]).toEqual([4]);
  });

  it("pasa la caducidad y los usos máximos entre la base y los campos", () => {
    const end = endOfDay("2026-10-31");
    expect(end).not.toBeNull();
    expect(dateInputValue(end)).toBe("2026-10-31");
    expect(dateInputValue(null)).toBe("");
    expect(endOfDay("")).toBeNull();
    expect(parseMaxUses("")).toBeNull();
    expect(parseMaxUses(" 50 ")).toBe(50);
    expect(parseMaxUses("0")).toBe("invalid");
    expect(parseMaxUses("2.5")).toBe("invalid");
  });

});

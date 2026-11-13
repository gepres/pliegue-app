import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { generalNotices, localDay, noticeDateLabel, noticeToShow, type GeneralNotice } from "./general-library-notices";

/** Ancho y alto de un WebP, de su cabecera: VP8 (con pérdida), VP8L (sin pérdida) o VP8X. */
function webpSize(bytes: Buffer) {
  expect(bytes.toString("ascii", 0, 4) + bytes.toString("ascii", 8, 12)).toBe("RIFFWEBP");
  const chunk = bytes.toString("ascii", 12, 16);
  if (chunk === "VP8X") return { height: bytes.readUIntLE(27, 3) + 1, width: bytes.readUIntLE(24, 3) + 1 };
  if (chunk === "VP8L") {
    const bits = bytes.readUInt32LE(21);
    return { height: ((bits >> 14) & 0x3fff) + 1, width: (bits & 0x3fff) + 1 };
  }
  return { height: bytes.readUInt16LE(28) & 0x3fff, width: bytes.readUInt16LE(26) & 0x3fff };
}

const invitation: GeneralNotice = { date: "2026-11-12", id: "pliegue", kind: "pliegue", text: "Úsalo con los tuyos.", title: "Haz lo mismo con tus libros" };
const news = (id: string, date: string, until?: string): GeneralNotice => ({ date, id, kind: "novedad", text: "…", title: id, ...(until ? { until } : {}) });

describe("avisos de la biblioteca general (03.13d)", () => {
  it("se muestra el más reciente que siga vigente y no se haya ocultado", () => {
    const notices = [invitation, news("libros-nuevos", "2026-11-20")];
    expect(noticeToShow(notices, new Set(), "2026-11-21")?.id).toBe("libros-nuevos");
    // Ocultar la novedad deja ver la invitación…
    expect(noticeToShow(notices, new Set(["libros-nuevos"]), "2026-11-21")?.id).toBe("pliegue");
    // …y con las dos ocultas no queda nada.
    expect(noticeToShow(notices, new Set(["libros-nuevos", "pliegue"]), "2026-11-21")).toBeNull();
  });

  it("una novedad va antes que la invitación aunque sean del mismo día o la novedad sea anterior", () => {
    expect(noticeToShow([invitation, news("mismo-dia", "2026-11-12")], new Set(), "2026-11-20")?.id).toBe("mismo-dia");
    expect(noticeToShow([invitation, news("antes", "2026-11-01")], new Set(), "2026-11-20")?.id).toBe("antes");
  });

  it("una novedad nueva vuelve a aparecer aunque se ocultara todo lo anterior", () => {
    const notices = [invitation, news("libros-nuevos", "2026-11-20"), news("lector", "2026-12-01")];
    expect(noticeToShow(notices, new Set(["libros-nuevos", "pliegue"]), "2026-12-02")?.id).toBe("lector");
  });

  it("una novedad con fecha futura espera a su día, y una caducada ya no sale", () => {
    const notices = [invitation, news("mañana", "2026-11-22"), news("feria", "2026-11-01", "2026-11-15")];
    expect(noticeToShow(notices, new Set(), "2026-11-21")?.id).toBe("pliegue");
    expect(noticeToShow(notices, new Set(), "2026-11-22")?.id).toBe("mañana");
    // El último día de `until` todavía se muestra.
    expect(noticeToShow([news("feria", "2026-11-01", "2026-11-15")], new Set(), "2026-11-15")?.id).toBe("feria");
    expect(noticeToShow([news("feria", "2026-11-01", "2026-11-15")], new Set(), "2026-11-16")).toBeNull();
  });

  it("los avisos publicados tienen id único, fechas bien escritas y enlaces dentro de Pliegue", () => {
    const ids = generalNotices.map((notice) => notice.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const notice of generalNotices) {
      expect(notice.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (notice.until) expect(notice.until >= notice.date).toBe(true);
      for (const link of [notice.action, notice.more]) if (link) expect(link.href).toMatch(/^\/(?!\/)/);
    }
    // La invitación a usar Pliegue está y lleva a la app.
    expect(generalNotices.find((notice) => notice.kind === "pliegue")?.action?.href).toBe("/app");
  });

  it("los banners publicados existen en public/, miden lo que dicen y tienen su texto alternativo", () => {
    for (const notice of generalNotices) {
      if (!notice.banner) continue;
      // El texto alternativo dice lo mismo que la imagen: al menos el título.
      expect(notice.banner.alt).toContain(notice.title);
      for (const image of [notice.banner.desktop, notice.banner.mobile]) {
        expect(image.src).toMatch(/^\/avisos\/[\w-]+\.webp$/);
        const bytes = readFileSync(fileURLToPath(new URL(`../../public${image.src}`, import.meta.url)));
        expect(webpSize(bytes)).toEqual({ height: image.height, width: image.width });
      }
    }
  });

  it("el día local y la fecha a la vista", () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(noticeDateLabel("2026-11-12", "2026-11-20")).toBe("12 de noviembre");
    expect(noticeDateLabel("2026-11-12", "2027-01-03")).toBe("12 de noviembre de 2026");
  });
});

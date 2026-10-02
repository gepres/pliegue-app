import { describe, expect, it } from "vitest";

import { describeDrive, folderPermission, formatBytes, summarizeFiles } from "./sources-summary";

const drive = { authorized: true, configured: true, email: "lectora@ejemplo.com", files: 426, folders: 1, readonly: true, tokenReady: true };

describe("resumen de fuentes", () => {
  it("escribe los tamaños en español", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1,5 KB");
    expect(formatBytes(250 * 1024 * 1024)).toBe("250 MB");
    expect(formatBytes(12.34 * 1024 ** 3)).toBe("12,3 GB");
    expect(formatBytes(Number.NaN)).toBe("—");
  });

  it("explica el permiso de una carpeta y si hace falta actuar", () => {
    expect(folderPermission("granted")).toMatchObject({ action: false, tone: "ok" });
    expect(folderPermission("prompt")).toMatchObject({ action: true, tone: "warn" });
    expect(folderPermission("denied")).toMatchObject({ action: true, tone: "error" });
  });

  it("cuenta archivos, lo que ocupan y los que piden permiso", () => {
    expect(
      summarizeFiles([
        { availability: "available", sizeBytes: 100 },
        { availability: "disconnected", sizeBytes: 50 },
        { availability: "offline" },
      ]),
    ).toEqual({ bytes: 150, count: 3, needPermission: 1 });
  });

  it("describe Google Drive conectado, con su cuenta, permiso y sesión", () => {
    expect(describeDrive(drive)).toEqual({
      details: [
        "1 carpeta · 426 archivos",
        "Permiso: leer las carpetas que vinculas, sin poder cambiar nada.",
        "Sesión activa en esta pestaña.",
      ],
      headline: "Conectado como lectora@ejemplo.com.",
      state: "connected",
    });
    expect(describeDrive({ ...drive, readonly: false, tokenReady: false }).details.slice(1)).toEqual([
      "Permiso: solo los archivos que eliges, uno a uno.",
      "La sesión de Google dura una hora: al abrir un libro o buscar cambios se reconecta con un clic.",
    ]);
  });

  it("sin configurar, sin conectar o desconectado con libros", () => {
    expect(describeDrive({ ...drive, configured: false }).state).toBe("unconfigured");
    expect(describeDrive({ ...drive, authorized: false, files: 0, folders: 0 })).toMatchObject({ headline: "Sin conectar." });
    expect(describeDrive({ ...drive, authorized: false }).headline).toMatch(/tus 426 archivos de Drive siguen en la biblioteca/);
  });
});

import type { MetadataRoute } from "next";

/**
 * Manifiesto de aplicación web: permite instalar Pliegue como app en el escritorio o en la
 * pantalla de inicio del teléfono, con ventana propia —sin barra de direcciones— y abriendo
 * directamente en la Biblioteca.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    background_color: "#fbf6ec",
    categories: ["books", "education", "productivity"],
    description: "Todo lo que guardaste, por fin entendible, legible y conectado.",
    display: "standalone",
    display_override: ["window-controls-overlay", "standalone"],
    icons: [
      {
        purpose: "any",
        sizes: "any",
        src: "/brand/pliegue-mark.svg",
        type: "image/svg+xml",
      },
    ],
    id: "/app",
    lang: "es",
    name: "Pliegue",
    orientation: "any",
    scope: "/",
    short_name: "Pliegue",
    shortcuts: [
      { name: "Biblioteca", url: "/app/biblioteca" },
      { name: "Lector", url: "/app/lector" },
      { name: "Ajustes", url: "/app/ajustes" },
    ],
    start_url: "/app/biblioteca",
    theme_color: "#fbf6ec",
  };
}

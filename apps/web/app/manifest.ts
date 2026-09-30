import type { MetadataRoute } from "next";

/**
 * Manifiesto de aplicación web: permite instalar Pliegue como app en el escritorio o en la
 * pantalla de inicio del teléfono, con ventana propia —sin barra de direcciones— y abriendo
 * directamente en la Biblioteca.
 *
 * Sin `window-controls-overlay`: la cabecera no reserva el hueco de los botones de la ventana
 * y en Windows quedarían encima de ella. Iconos PNG de 192 y 512 px, y su versión «maskable»,
 * porque Windows, Android y el diálogo de instalación de Chrome no usan el SVG.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    background_color: "#fbf6ec",
    categories: ["books", "education", "productivity"],
    description: "Todo lo que guardaste, por fin entendible, legible y conectado.",
    display: "standalone",
    icons: [
      { purpose: "any", sizes: "192x192", src: "/icons/pliegue-192.png", type: "image/png" },
      { purpose: "any", sizes: "512x512", src: "/icons/pliegue-512.png", type: "image/png" },
      { purpose: "maskable", sizes: "192x192", src: "/icons/pliegue-maskable-192.png", type: "image/png" },
      { purpose: "maskable", sizes: "512x512", src: "/icons/pliegue-maskable-512.png", type: "image/png" },
      { purpose: "any", sizes: "any", src: "/icons/pliegue-app.svg", type: "image/svg+xml" },
    ],
    // Abrirla otra vez enfoca la ventana que ya está abierta en lugar de duplicarla.
    launch_handler: { client_mode: ["navigate-existing", "auto"] },
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

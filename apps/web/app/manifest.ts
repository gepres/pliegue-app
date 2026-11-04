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
    // «Abrir con → Pliegue» desde el Explorador o el Finder, con la app instalada (06.6). Solo
    // los formatos que el lector abre; los archivos se vinculan sin copiarse (/app/abrir).
    file_handlers: [
      {
        accept: {
          "application/epub+zip": [".epub"],
          "application/pdf": [".pdf"],
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
        },
        action: "/app/abrir",
      },
    ],
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
    // El diálogo de instalación de Chrome las enseña: ancha en el escritorio, estrecha en el
    // móvil. Biblioteca de ejemplo con clásicos de dominio público y portadas propias.
    screenshots: [
      {
        form_factor: "wide",
        label: "La Biblioteca: tus libros con portada, autor y categoría",
        sizes: "1280x800",
        src: "/screenshots/biblioteca-wide.webp",
        type: "image/webp",
      },
      {
        form_factor: "narrow",
        label: "El lector, con el Quijote abierto en el móvil",
        sizes: "780x1688",
        src: "/screenshots/lector-narrow.webp",
        type: "image/webp",
      },
    ],
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

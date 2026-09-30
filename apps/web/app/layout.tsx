import type { Metadata, Viewport } from "next";
import Script from "next/script";
import type { ReactNode } from "react";

import "@fontsource/cormorant-garamond/600.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/source-serif-4/400.css";
import "@pliegue/tokens/tokens.css";
import "@pliegue/ui/styles.css";
import "./globals.css";
import { AuthReturn } from "./cloud/auth-return";
import { earlyInstallCapture } from "./pwa/install-store";
import { PwaBootstrap } from "./pwa/pwa-bootstrap";
import { PreferenceBridge } from "./preferences/preference-bridge";

export const metadata: Metadata = {
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Pliegue",
  },
  applicationName: "Pliegue",
  // Sin icono declarado, el navegador pedía /favicon.ico en cada carga y recibía un 404.
  icons: {
    apple: [{ sizes: "180x180", url: "/icons/apple-touch-icon.png" }],
    icon: [{ type: "image/svg+xml", url: "/brand/pliegue-mark.svg" }],
  },
  title: {
    default: "Pliegue",
    template: "%s · Pliegue",
  },
  description:
    "Todo lo que guardaste, por fin entendible, legible y conectado.",
};

/**
 * `viewport-fit=cover` deja que la app llegue bajo la muesca y la barra de gestos; las
 * barras propias compensan con `env(safe-area-inset-*)`. El color de tema tiñe la barra del
 * sistema igual que el lienzo, para que no se note dónde acaba la app.
 */
export const viewport: Viewport = {
  initialScale: 1,
  themeColor: [
    { color: "#fbf6ec", media: "(prefers-color-scheme: light)" },
    { color: "#171614", media: "(prefers-color-scheme: dark)" },
  ],
  viewportFit: "cover",
  width: "device-width",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="es">
      <body>
        {/* Chrome avisa de que se puede instalar muy pronto: se guarda el aviso antes de hidratar. */}
        <Script id="pliegue-install-capture" strategy="beforeInteractive">
          {earlyInstallCapture}
        </Script>
        <PreferenceBridge />
        <AuthReturn />
        <PwaBootstrap />
        {children}
      </body>
    </html>
  );
}

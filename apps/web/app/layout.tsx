import type { Metadata, Viewport } from "next";
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
import { PreferenceBridge } from "./preferences/preference-bridge";

export const metadata: Metadata = {
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Pliegue",
  },
  applicationName: "Pliegue",
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
        <PreferenceBridge />
        {children}
      </body>
    </html>
  );
}

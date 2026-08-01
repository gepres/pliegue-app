import type { Metadata } from "next";
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
  title: {
    default: "Pliegue",
    template: "%s · Pliegue",
  },
  description:
    "Todo lo que guardaste, por fin entendible, legible y conectado.",
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

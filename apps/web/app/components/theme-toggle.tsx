"use client";

import { Button } from "@pliegue/ui";

import type { Theme } from "../preferences/preferences";
import { setPreference, usePreferences } from "../preferences/preference-store";
import { IconButton } from "./app-ui/controls";
import type { IconName } from "./app-ui/icons";

const labels: Record<Theme, string> = {
  dark: "Oscuro",
  light: "Claro",
  system: "Sistema",
};

const icons: Record<Theme, IconName> = {
  dark: "moon",
  light: "sun",
  system: "monitor",
};

/**
 * `compact` lo reduce a un icono para las barras de la app, donde cada palabra de más le
 * quita sitio al título. La versión con texto sigue en la portada y en el catálogo.
 */
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { resolved } = usePreferences();
  const theme = resolved.theme;

  function cycleTheme() {
    const next: Theme =
      theme === "system" ? "light" : theme === "light" ? "dark" : "system";
    setPreference("workspace", "theme", next);
  }

  if (compact) {
    return (
      <IconButton
        icon={icons[theme]}
        label={`Tema: ${labels[theme]}. Cambiar tema`}
        onClick={cycleTheme}
      />
    );
  }

  return (
    <Button
      aria-label={`Tema actual: ${labels[theme]}. Cambiar tema`}
      onClick={cycleTheme}
      size="sm"
      variant="quiet"
    >
      Tema · {labels[theme]}
    </Button>
  );
}

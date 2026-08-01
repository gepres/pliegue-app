"use client";

import { Button } from "@pliegue/ui";
import type { Theme } from "../preferences/preferences";
import { setPreference, usePreferences } from "../preferences/preference-store";

const labels: Record<Theme, string> = {
  dark: "Oscuro",
  light: "Claro",
  system: "Sistema",
};

export function ThemeToggle() {
  const { resolved } = usePreferences();
  const theme = resolved.theme;

  function cycleTheme() {
    const next: Theme =
      theme === "system" ? "light" : theme === "light" ? "dark" : "system";
    setPreference("workspace", "theme", next);
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

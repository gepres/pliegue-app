/**
 * Cómo quiere el usuario ver el marco de la aplicación en este dispositivo.
 *
 * Va aparte de las preferencias de lectura —tipografía, tema, interlineado— porque no
 * comparte su modelo: aquellas se resuelven por precedencia documento → Área → cuenta →
 * dispositivo, y plegar la navegación es una decisión de esta pantalla y de nadie más.
 */

export interface ShellLayoutState {
  /** La navegación lateral se reduce a un carril con los códigos de sección. */
  navigationCollapsed: boolean;
  version: 1;
}

export const defaultShellLayout: ShellLayoutState = {
  navigationCollapsed: false,
  version: 1,
};

export function parseShellLayout(value: unknown): ShellLayoutState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaultShellLayout;

  const candidate = value as Partial<ShellLayoutState>;
  if (candidate.version !== 1) return defaultShellLayout;

  return {
    navigationCollapsed: candidate.navigationCollapsed === true,
    version: 1,
  };
}

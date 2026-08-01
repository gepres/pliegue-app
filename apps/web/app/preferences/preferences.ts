export const preferenceScopes = ["device", "account", "workspace", "document"] as const;
export const themes = ["system", "light", "dark"] as const;
export const readerFonts = ["serif", "sans"] as const;
export const readerScales = [90, 100, 115, 130] as const;
export const lineHeights = ["compact", "comfortable", "relaxed"] as const;
export const languages = ["auto", "es", "en"] as const;
export const readingProfiles = ["balanced", "focus", "accessible"] as const;

export type PreferenceScope = (typeof preferenceScopes)[number];
export type Theme = (typeof themes)[number];
export type ReaderFont = (typeof readerFonts)[number];
export type ReaderScale = (typeof readerScales)[number];
export type LineHeight = (typeof lineHeights)[number];
export type Language = (typeof languages)[number];
export type ReadingProfile = (typeof readingProfiles)[number];

export interface ReadingPreferences {
  language: Language;
  lineHeight: LineHeight;
  profile: ReadingProfile;
  readerFont: ReaderFont;
  readerScale: ReaderScale;
  theme: Theme;
}

export type ScopedPreferences = Partial<ReadingPreferences>;

export interface PreferenceState {
  scopes: Record<PreferenceScope, ScopedPreferences>;
  version: 1;
}

export const defaultPreferences: ReadingPreferences = {
  language: "auto",
  lineHeight: "comfortable",
  profile: "balanced",
  readerFont: "serif",
  readerScale: 100,
  theme: "system",
};

export const emptyPreferenceState: PreferenceState = {
  scopes: {
    account: {},
    device: {},
    document: {},
    workspace: {},
  },
  version: 1,
};

export const profilePresets: Record<ReadingProfile, Pick<ReadingPreferences, "lineHeight" | "readerFont" | "readerScale">> = {
  accessible: { lineHeight: "relaxed", readerFont: "sans", readerScale: 130 },
  balanced: { lineHeight: "comfortable", readerFont: "serif", readerScale: 100 },
  focus: { lineHeight: "relaxed", readerFont: "serif", readerScale: 115 },
};

function includes<T>(values: readonly T[], value: unknown): value is T {
  return values.includes(value as T);
}

export function sanitizeScopedPreferences(value: unknown): ScopedPreferences {
  if (!value || typeof value !== "object") return {};

  const candidate = value as Record<string, unknown>;
  const result: ScopedPreferences = {};

  if (includes(languages, candidate.language)) result.language = candidate.language;
  if (includes(lineHeights, candidate.lineHeight)) result.lineHeight = candidate.lineHeight;
  if (includes(readingProfiles, candidate.profile)) result.profile = candidate.profile;
  if (includes(readerFonts, candidate.readerFont)) result.readerFont = candidate.readerFont;
  if (includes(readerScales, candidate.readerScale)) result.readerScale = candidate.readerScale;
  if (includes(themes, candidate.theme)) result.theme = candidate.theme;

  return result;
}

export function parsePreferenceState(value: unknown): PreferenceState {
  if (!value || typeof value !== "object") return emptyPreferenceState;

  const candidate = value as { scopes?: Record<string, unknown>; version?: unknown };
  if (candidate.version !== 1 || !candidate.scopes) return emptyPreferenceState;

  return {
    scopes: {
      account: sanitizeScopedPreferences(candidate.scopes.account),
      device: sanitizeScopedPreferences(candidate.scopes.device),
      document: sanitizeScopedPreferences(candidate.scopes.document),
      workspace: sanitizeScopedPreferences(candidate.scopes.workspace),
    },
    version: 1,
  };
}

export function resolvePreferences(state: PreferenceState): ReadingPreferences {
  return preferenceScopes.reduce<ReadingPreferences>(
    (resolved, scope) => ({ ...resolved, ...state.scopes[scope] }),
    defaultPreferences,
  );
}

export function updateScopedPreference<Key extends keyof ReadingPreferences>(
  state: PreferenceState,
  scope: PreferenceScope,
  key: Key,
  value: ReadingPreferences[Key] | undefined,
): PreferenceState {
  const nextScope = { ...state.scopes[scope] };

  if (value === undefined) delete nextScope[key];
  else nextScope[key] = value;

  return {
    ...state,
    scopes: { ...state.scopes, [scope]: nextScope },
  };
}

export function applyReadingProfile(
  state: PreferenceState,
  scope: PreferenceScope,
  profile: ReadingProfile,
): PreferenceState {
  return {
    ...state,
    scopes: {
      ...state.scopes,
      [scope]: {
        ...state.scopes[scope],
        ...profilePresets[profile],
        profile,
      },
    },
  };
}

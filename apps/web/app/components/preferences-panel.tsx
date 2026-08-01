"use client";

import { useState } from "react";

import { Button, Card, Field, Select, Tag } from "@pliegue/ui";

import {
  languages,
  lineHeights,
  preferenceScopes,
  readerFonts,
  readerScales,
  readingProfiles,
  themes,
  type Language,
  type LineHeight,
  type PreferenceScope,
  type ReaderFont,
  type ReaderScale,
  type ReadingProfile,
  type Theme,
} from "../preferences/preferences";
import {
  resetAllPreferences,
  resetPreferenceScope,
  setPreference,
  setReadingProfile,
  usePreferences,
} from "../preferences/preference-store";
import styles from "../(workspace)/app/workspace.module.css";

const scopeLabels: Record<PreferenceScope, string> = {
  account: "Cuenta",
  device: "Dispositivo",
  document: "Documento actual",
  workspace: "Área personal",
};

const themeLabels: Record<Theme, string> = {
  dark: "Oscuro",
  light: "Claro",
  system: "Sistema",
};

const fontLabels: Record<ReaderFont, string> = {
  sans: "Sans serif accesible",
  serif: "Serif editorial",
};

const lineHeightLabels: Record<LineHeight, string> = {
  comfortable: "Cómodo",
  compact: "Compacto",
  relaxed: "Relajado",
};

const languageLabels: Record<Language, string> = {
  auto: "Automático",
  en: "English",
  es: "Español",
};

const profileLabels: Record<ReadingProfile, string> = {
  accessible: "Accesible",
  balanced: "Equilibrado",
  focus: "Concentración",
};

export function PreferencesPanel() {
  const [scope, setScope] = useState<PreferenceScope>("device");
  const [status, setStatus] = useState("Preferencias listas.");
  const { resolved, state } = usePreferences();
  const current = state.scopes[scope];

  function saved(message: string) {
    setStatus(`${message} Guardado en este dispositivo.`);
  }

  function updateTheme(value: string) {
    setPreference(scope, "theme", value ? (value as Theme) : undefined);
    saved("Tema actualizado.");
  }

  function updateFont(value: string) {
    setPreference(scope, "readerFont", value ? (value as ReaderFont) : undefined);
    saved("Tipografía actualizada.");
  }

  function updateScale(value: string) {
    setPreference(scope, "readerScale", value ? (Number(value) as ReaderScale) : undefined);
    saved("Tamaño de lectura actualizado.");
  }

  function updateLineHeight(value: string) {
    setPreference(scope, "lineHeight", value ? (value as LineHeight) : undefined);
    saved("Interlineado actualizado.");
  }

  function updateLanguage(value: string) {
    setPreference(scope, "language", value ? (value as Language) : undefined);
    saved("Idioma actualizado.");
  }

  function updateProfile(value: string) {
    if (!value) {
      setPreference(scope, "profile", undefined);
      saved("Perfil heredado.");
      return;
    }

    setReadingProfile(scope, value as ReadingProfile);
    saved("Perfil de lectura aplicado.");
  }

  function resetScope() {
    resetPreferenceScope(scope);
    saved(`${scopeLabels[scope]} restaurado.`);
  }

  function resetAll() {
    resetAllPreferences();
    setStatus("Todas las preferencias volvieron a sus valores iniciales.");
  }

  return (
    <section aria-labelledby="reading-preferences-title" className={styles.preferenceSection}>
      <div className={styles.preferenceIntro}>
        <div>
          <Tag>Apariencia · lectura</Tag>
          <h2 id="reading-preferences-title">Preferencias por contexto</h2>
          <p>
            El documento prevalece sobre el Área, la cuenta y el dispositivo. Si un
            nivel no define un valor, Pliegue hereda el siguiente disponible.
          </p>
        </div>
        <Field
          description="Elige dónde se guarda el cambio. La sincronización de cuenta se activará con el backend."
          label="Editar preferencias de"
          labelFor="preference-scope"
        >
          <Select
            id="preference-scope"
            onChange={(event) => setScope(event.target.value as PreferenceScope)}
            value={scope}
          >
            {preferenceScopes.map((item) => (
              <option key={item} value={item}>
                {scopeLabels[item]}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className={styles.preferenceGrid}>
        <Field label="Tema" labelFor="preference-theme">
          <Select
            id="preference-theme"
            onChange={(event) => updateTheme(event.target.value)}
            value={current.theme ?? ""}
          >
            <option value="">Heredar · {themeLabels[resolved.theme]}</option>
            {themes.map((theme) => (
              <option key={theme} value={theme}>
                {themeLabels[theme]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Perfil de lectura" labelFor="preference-profile">
          <Select
            id="preference-profile"
            onChange={(event) => updateProfile(event.target.value)}
            value={current.profile ?? ""}
          >
            <option value="">Heredar · {profileLabels[resolved.profile]}</option>
            {readingProfiles.map((profile) => (
              <option key={profile} value={profile}>
                {profileLabels[profile]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Tipografía del lector" labelFor="preference-font">
          <Select
            id="preference-font"
            onChange={(event) => updateFont(event.target.value)}
            value={current.readerFont ?? ""}
          >
            <option value="">Heredar · {fontLabels[resolved.readerFont]}</option>
            {readerFonts.map((font) => (
              <option key={font} value={font}>
                {fontLabels[font]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Tamaño del texto" labelFor="preference-scale">
          <Select
            id="preference-scale"
            onChange={(event) => updateScale(event.target.value)}
            value={current.readerScale ?? ""}
          >
            <option value="">Heredar · {resolved.readerScale} %</option>
            {readerScales.map((scale) => (
              <option key={scale} value={scale}>
                {scale} %
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Interlineado" labelFor="preference-line-height">
          <Select
            id="preference-line-height"
            onChange={(event) => updateLineHeight(event.target.value)}
            value={current.lineHeight ?? ""}
          >
            <option value="">Heredar · {lineHeightLabels[resolved.lineHeight]}</option>
            {lineHeights.map((lineHeight) => (
              <option key={lineHeight} value={lineHeight}>
                {lineHeightLabels[lineHeight]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Idioma de interfaz" labelFor="preference-language">
          <Select
            id="preference-language"
            onChange={(event) => updateLanguage(event.target.value)}
            value={current.language ?? ""}
          >
            <option value="">Heredar · {languageLabels[resolved.language]}</option>
            {languages.map((language) => (
              <option key={language} value={language}>
                {languageLabels[language]}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Card className={styles.preferenceSummary} tone="subtle">
        <div>
          <span>Resultado efectivo</span>
          <strong>
            {themeLabels[resolved.theme]} · {fontLabels[resolved.readerFont]} · {resolved.readerScale} %
          </strong>
        </div>
        <div className={styles.preferenceActions}>
          <Button onClick={resetScope} size="sm" variant="secondary">
            Restablecer este nivel
          </Button>
          <Button onClick={resetAll} size="sm" variant="quiet">
            Restablecer todo
          </Button>
        </div>
      </Card>

      <p aria-live="polite" className={styles.preferenceStatus} role="status">
        {status}
      </p>
    </section>
  );
}

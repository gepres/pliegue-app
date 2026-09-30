"use client";

import { useState, useSyncExternalStore } from "react";

import { Button, Card, Field, Input, Select, Switch, Tag } from "@pliegue/ui";

import { defaultAiSettings, normalizeAzureRegion, translationProviderOf, type AiSettings } from "../ai/ai-settings";
import { saveAiSettings, useAiSettings } from "../ai/ai-settings-store";
import {
  clearSessionApiKey,
  setSessionApiKey,
  useAiSessionSecrets,
} from "../ai/ai-session-secret-store";
import { checkApiKey, normalizeApiKey, type KeyProvider } from "../ai/api-key";
import type { AiProvider } from "../ai/document-catalog";
import { translationProviderChoices, type TranslationProviderChoice } from "../ai/translation-options";
import styles from "../(workspace)/app/workspace.module.css";
import { IconButton } from "./app-ui/controls";
import { TranslationComparison } from "./translation-comparison";

const providerLabels: Record<AiProvider, string> = {
  anthropic: "Anthropic · Claude",
  gemini: "Google · Gemini",
  ollama: "Ollama",
  openai: "OpenAI",
};

/** Quién pide clave: los proveedores de IA alojados y Azure Translator. */
const keyLabels: Record<KeyProvider, string> = {
  anthropic: "Anthropic · Claude",
  azure: "Azure Translator",
  gemini: "Google · Gemini",
  openai: "OpenAI",
};

/** Con qué traducir: el traductor del navegador es el predeterminado; lo demás, a elección. */
const translationLabels: Record<TranslationProviderChoice, string> = {
  anthropic: "Anthropic · Claude",
  azure: "Azure Translator",
  browser: "Chrome o Edge · gratis, en tu equipo",
  gemini: "Google · Gemini",
  ollama: "Ollama · en tu equipo",
  openai: "OpenAI",
};

const removedList = new Intl.ListFormat("es", { type: "conjunction" });

function subscribeToNothing() {
  return () => {};
}

/**
 * El campo de la clave no es de contraseña. El gestor del navegador tomaba «Modelo» + clave por
 * un inicio de sesión: de vez en cuando lo rellenaba con lo guardado para este origen —a veces
 * un texto que no era una clave, y entonces «esto no parece una API key»— y al pulsar «Guardar»
 * ofrecía guardarla como contraseña. Se enmascara con CSS; donde eso no existe, vuelve a ser de
 * contraseña, pero «nueva», que los navegadores no rellenan.
 */
function useTextMask() {
  return useSyncExternalStore(
    subscribeToNothing,
    () => CSS.supports("-webkit-text-security", "disc"),
    () => true,
  );
}

/**
 * La clave de un proveedor para esta sesión. Aparece una vez por proveedor: en «Catalogar» y,
 * si la traducción usa otro, también en «Traducir con tu IA». Cada proveedor guarda la suya.
 */
function ApiKeyField({ id, provider }: { id: string; provider: KeyProvider }) {
  const secrets = useAiSessionSecrets();
  const textMask = useTextMask();
  const [revealKey, setRevealKey] = useState(false);
  const [keyNote, setKeyNote] = useState<string | null>(null);
  const apiKey = secrets[provider];
  // Se avisa al pegar, no al analizar: un texto pegado por error no debe llegar al proveedor.
  const apiKeyCheck = apiKey ? checkApiKey(provider, apiKey) : null;
  // Enmascarada no se ve qué se pegó: el ojo lo enseña.
  const apiKeyIssue = apiKeyCheck?.error
    ? `${apiKeyCheck.error} Con el ojo puedes ver qué se pegó.`
    : (apiKeyCheck?.warning ?? null);

  function changeApiKey(value: string) {
    const { key, removed } = normalizeApiKey(value);
    setSessionApiKey(provider, key);
    setKeyNote(removed.length ? `Se quitó ${removedList.format(removed)}: queda solo la clave.` : null);
  }

  function clearApiKey() {
    clearSessionApiKey(provider);
    setKeyNote(null);
    setRevealKey(false);
  }

  return (
    <Field className={styles.aiSecretField} label={`API key de ${keyLabels[provider]}`} labelFor={id}>
      <div className={styles.aiSecretControl}>
        <Input
          autoCapitalize="none"
          autoComplete={textMask ? "off" : "new-password"}
          autoCorrect="off"
          className={textMask && !revealKey ? styles.aiSecretMasked : undefined}
          data-1p-ignore=""
          data-bwignore=""
          data-form-type="other"
          data-lpignore="true"
          id={id}
          name={`pliegue-ai-session-key-${provider}`}
          onChange={(event) => changeApiKey(event.target.value)}
          placeholder="Pega una clave para esta sesión"
          spellCheck={false}
          type={textMask || revealKey ? "text" : "password"}
          value={apiKey}
        />
        <IconButton
          aria-controls={id}
          aria-pressed={revealKey}
          disabled={!apiKey}
          icon={revealKey ? "eyeOff" : "eye"}
          label={revealKey ? "Ocultar la clave" : "Mostrar la clave"}
          onClick={() => setRevealKey((current) => !current)}
        />
        <Button disabled={!apiKey} onClick={clearApiKey} type="button" variant="danger">
          Borrar
        </Button>
      </div>
      {apiKeyIssue ? (
        <p className={styles.aiSecretIssue} role="alert">
          {apiKeyIssue}
        </p>
      ) : keyNote ? (
        <p className={styles.aiSecretIssue} role="status">
          {keyNote}
        </p>
      ) : provider === "gemini" ? (
        <p className={styles.aiSecretIssue}>
          Gemini tiene nivel gratuito, con límites de uso: la clave se crea en{" "}
          <a href="https://aistudio.google.com/apikey" rel="noreferrer" target="_blank">
            Google AI Studio
          </a>
          . En ese nivel Google puede usar lo enviado para mejorar sus productos.
        </p>
      ) : provider === "azure" ? (
        <p className={styles.aiSecretIssue}>
          Está en tu recurso de Translator del portal de Azure, en «Claves y punto de conexión». El
          plan gratuito (F0) da 2 millones de caracteres al mes.
        </p>
      ) : null}
    </Field>
  );
}

/** Dónde está Ollama. Se comparte: si cataloga y traduce con él, es el mismo servicio. */
function OllamaFields({
  draft,
  onChange,
}: {
  draft: AiSettings;
  onChange: (update: (current: AiSettings) => AiSettings) => void;
}) {
  return (
    <>
      <Field label="Ubicación de Ollama" labelFor="ollama-mode">
        <Select
          id="ollama-mode"
          onChange={(event) => {
            const mode = event.target.value as AiSettings["ollamaMode"];
            onChange((current) => ({
              ...current,
              ollamaMode: mode,
              ollamaUrl: mode === "local" ? defaultAiSettings.ollamaUrl : current.ollamaUrl,
            }));
          }}
          value={draft.ollamaMode}
        >
          <option value="local">Local · este dispositivo</option>
          <option value="remote">Remoto · URL propia</option>
        </Select>
      </Field>
      <Field label="URL de Ollama" labelFor="ollama-url">
        <Input
          disabled={draft.ollamaMode === "local"}
          id="ollama-url"
          onChange={(event) => {
            const url = event.target.value;
            onChange((current) => ({ ...current, ollamaUrl: url }));
          }}
          placeholder="https://ollama.tudominio.com"
          type="url"
          value={draft.ollamaUrl}
        />
      </Field>
    </>
  );
}

export function AiSettingsPanel() {
  const settings = useAiSettings();
  const [draft, setDraft] = useState<AiSettings>(settings);
  const [edited, setEdited] = useState(false);
  // Al cargar la página, la primera pintada ve los ajustes por defecto (los del servidor) y
  // después llegan los guardados. Sin esto el formulario se quedaba con los de fábrica y
  // «Guardar» los escribía encima de los de la persona. Mientras no haya tocado nada, el
  // borrador sigue a lo guardado.
  const [shownSettings, setShownSettings] = useState(settings);
  if (shownSettings !== settings) {
    setShownSettings(settings);
    if (!edited) setDraft(settings);
  }
  const editDraft: typeof setDraft = (next) => {
    setEdited(true);
    setDraft(next);
  };
  const [status, setStatus] = useState(
    "El análisis automático está apagado hasta que lo actives expresamente.",
  );

  const translationProvider = translationProviderOf(draft);
  const sameProvider = translationProvider === draft.provider;
  // Un modelo que elegir: solo los LLM. El navegador y Azure Translator no tienen.
  const translationModelProvider: AiProvider | null =
    translationProvider === "browser" || translationProvider === "azure" ? null : translationProvider;

  function updateModel(model: string) {
    editDraft((current) => ({
      ...current,
      models: { ...current.models, [current.provider]: model },
    }));
  }

  function updateTranslationModel(model: string) {
    if (!translationModelProvider) return;
    editDraft((current) => ({
      ...current,
      translationModels: { ...current.translationModels, [translationModelProvider]: model },
    }));
  }

  function chooseTranslation(choice: TranslationProviderChoice) {
    editDraft((current) => ({ ...current, translationProvider: choice }));
  }

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    saveAiSettings(draft);
    // Guardado: lo que se ve vuelve a seguir a lo guardado.
    setEdited(false);
    setStatus(
      draft.autoAnalyzeAfterLink
        ? "Ajustes guardados. Los documentos nuevos o modificados se catalogarán al volver a Biblioteca."
        : "Ajustes guardados. El análisis continuará siendo manual.",
    );
  }

  return (
    <Card aria-labelledby="ai-settings-title" as="section" className={styles.aiSettingsPanel}>
      <div className={styles.aiSettingsIntro}>
        <div>
          <Tag>IA · catálogo y traducción BYOK</Tag>
          <h2 id="ai-settings-title">Elige tu proveedor de IA</h2>
          <p>
            Con tu propia clave, Pliegue cataloga tus documentos. Para traducir libros usa, por
            defecto, el traductor de Chrome o Edge, gratis y en tu equipo; una IA es opcional y puede
            ser otra que la de catalogar. Para catalogar se envía un extracto limitado; para
            traducir con una IA, el texto de la página que se traduce. Nunca el archivo completo.
          </p>
        </div>
        <div className={styles.aiPrivacyStamp}>
          <span>Credencial</span>
          <strong>
            {draft.provider === "ollama" && (translationProvider === "browser" || translationProvider === "ollama")
              ? "No requerida"
              : "Solo esta sesión"}
          </strong>
          <small>Se elimina al recargar o cerrar la pestaña.</small>
        </div>
      </div>

      <form className={styles.aiSettingsForm} onSubmit={save}>
        {/* ---- Catalogar ------------------------------------------------------------ */}
        <div className={styles.aiGroupHead}>
          <h3>Catalogar</h3>
          <p>Autor, año, género, idioma y sinopsis de cada documento de la Biblioteca.</p>
        </div>

        <Field label="Proveedor para catalogar" labelFor="ai-provider">
          <Select
            id="ai-provider"
            onChange={(event) => {
              const provider = event.target.value as AiProvider;
              editDraft((current) => ({ ...current, provider }));
            }}
            value={draft.provider}
          >
            {Object.entries(providerLabels).map(([provider, label]) => (
              <option key={provider} value={provider}>
                {label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Modelo para catalogar" labelFor="ai-model">
          <Input
            autoComplete="off"
            id="ai-model"
            name="pliegue-ai-model"
            onChange={(event) => updateModel(event.target.value)}
            placeholder="Identificador del modelo"
            spellCheck={false}
            value={draft.models[draft.provider]}
          />
        </Field>

        {draft.provider === "ollama" ? (
          <OllamaFields draft={draft} onChange={editDraft} />
        ) : (
          <ApiKeyField id="ai-api-key" provider={draft.provider} />
        )}

        <Field label="Extracto máximo por archivo" labelFor="ai-excerpt">
          <Select
            id="ai-excerpt"
            onChange={(event) =>
              editDraft((current) => ({
                ...current,
                maxExcerptCharacters: Number(event.target.value),
              }))
            }
            value={draft.maxExcerptCharacters}
          >
            <option value={8_000}>8.000 caracteres · menor costo</option>
            <option value={12_000}>12.000 caracteres · equilibrado</option>
            <option value={24_000}>24.000 caracteres · más contexto</option>
          </Select>
        </Field>

        <Field label="Análisis simultáneos" labelFor="ai-concurrency">
          <Select
            id="ai-concurrency"
            onChange={(event) =>
              editDraft((current) => ({ ...current, concurrency: Number(event.target.value) }))
            }
            value={draft.concurrency}
          >
            <option value={1}>1 · conservador</option>
            <option value={2}>2 · recomendado</option>
            <option value={3}>3 · rápido</option>
            <option value={4}>4 · biblioteca grande</option>
            <option value={6}>6 · máximo</option>
          </Select>
        </Field>

        <Switch
          checked={draft.autoAnalyzeAfterLink}
          className={styles.aiAutoControl}
          description="Solo procesa archivos con texto local disponible y omite versiones ya catalogadas."
          label="Analizar después de vincular o detectar cambios"
          onChange={(event) =>
            editDraft((current) => ({
              ...current,
              autoAnalyzeAfterLink: event.target.checked,
            }))
          }
        />

        {/* ---- Traducir ------------------------------------------------------------- */}
        <div className={styles.aiGroupHead} id="ai-traduccion">
          <h3>Traducir libros</h3>
          <p>
            Por defecto, el traductor de Chrome o Edge: gratis, al instante y sin que el texto salga de
            tu equipo. Si quieres más calidad, o traducir en el móvil, Firefox o Safari, elige una IA o
            Azure Translator, con tu clave. En el lector siempre puedes cambiar de uno a otro.
          </p>
        </div>

        <Field label="Traductor" labelFor="ai-translation-provider">
          <Select
            id="ai-translation-provider"
            onChange={(event) => chooseTranslation(event.target.value as TranslationProviderChoice)}
            value={translationProvider}
          >
            {translationProviderChoices.map((choice) => (
              <option key={choice} value={choice}>
                {translationLabels[choice]}
                {choice === "browser" ? " · predeterminado" : ""}
              </option>
            ))}
          </Select>
        </Field>

        {translationModelProvider ? (
          <Field label="Modelo para traducir" labelFor="ai-translation-model">
            <Input
              autoComplete="off"
              id="ai-translation-model"
              name="pliegue-ai-translation-model"
              onChange={(event) => updateTranslationModel(event.target.value)}
              placeholder="Identificador del modelo"
              spellCheck={false}
              value={draft.translationModels[translationModelProvider]}
            />
          </Field>
        ) : translationProvider === "azure" ? (
          <Field
            description="La del recurso, como «westeurope». Vacía si el recurso es global."
            label="Región de Azure"
            labelFor="ai-azure-region"
          >
            <Input
              autoComplete="off"
              id="ai-azure-region"
              onBlur={(event) => {
                const region = normalizeAzureRegion(event.target.value);
                editDraft((current) => ({ ...current, azureRegion: region }));
              }}
              onChange={(event) => {
                const region = event.target.value;
                editDraft((current) => ({ ...current, azureRegion: region }));
              }}
              placeholder="westeurope"
              spellCheck={false}
              value={draft.azureRegion}
            />
          </Field>
        ) : (
          <p className={styles.aiGroupNote}>
            No necesita clave ni configuración. Funciona en Chrome y Edge de escritorio; en el móvil,
            Firefox o Safari, elige una IA.
          </p>
        )}

        {/* La clave del traductor: la misma de arriba si es el mismo proveedor, o la suya. */}
        {translationProvider === "browser" ? null : translationProvider === "ollama" ? (
          draft.provider === "ollama" ? (
            <p className={styles.aiGroupNote}>Traduce con el mismo Ollama de arriba: el texto no sale de tu equipo.</p>
          ) : (
            <OllamaFields draft={draft} onChange={editDraft} />
          )
        ) : sameProvider ? (
          <p className={styles.aiGroupNote}>
            Usa la misma clave de {keyLabels[translationProvider]} que has puesto arriba.
          </p>
        ) : (
          <ApiKeyField id="ai-translation-api-key" provider={translationProvider} />
        )}

        <TranslationComparison onChoose={chooseTranslation} selected={translationProvider} />

        <div className={styles.aiSettingsActions}>
          <Button type="submit">Guardar ajustes de IA</Button>
          <span aria-live="polite" role="status">
            {status}
          </span>
        </div>
      </form>

      <div className={styles.aiProviderNote} role="note">
        <strong>Frontera de privacidad</strong>
        <p>
          OpenAI, Anthropic y Gemini reciben la clave y el texto mediante la ruta de servidor de
          Pliegue, sin persistencia ni logs de contenido. Ollama se consulta directamente desde
          el navegador; una URL remota debe habilitar CORS para el origen de la app.
        </p>
      </div>
    </Card>
  );
}

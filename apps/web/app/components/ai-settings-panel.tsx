"use client";

import { useState, useSyncExternalStore } from "react";

import { Button, Card, Field, Input, Select, Switch, Tag } from "@pliegue/ui";

import { defaultAiSettings, type AiSettings } from "../ai/ai-settings";
import { saveAiSettings, useAiSettings } from "../ai/ai-settings-store";
import {
  clearSessionApiKey,
  setSessionApiKey,
  useAiSessionSecrets,
} from "../ai/ai-session-secret-store";
import { checkApiKey, normalizeApiKey } from "../ai/api-key";
import type { AiProvider } from "../ai/document-catalog";
import styles from "../(workspace)/app/workspace.module.css";
import { IconButton } from "./app-ui/controls";

const providerLabels: Record<AiProvider, string> = {
  anthropic: "Anthropic · Claude",
  ollama: "Ollama",
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

export function AiSettingsPanel() {
  const settings = useAiSettings();
  const secrets = useAiSessionSecrets();
  const textMask = useTextMask();
  const [draft, setDraft] = useState<AiSettings>(settings);
  const [revealKey, setRevealKey] = useState(false);
  const [keyNote, setKeyNote] = useState<string | null>(null);
  const [status, setStatus] = useState(
    "El análisis automático está apagado hasta que lo actives expresamente.",
  );

  const hostedProvider = draft.provider === "ollama" ? null : draft.provider;
  const selectedApiKey = hostedProvider ? secrets[hostedProvider] : "";
  // Se avisa al pegar, no al analizar: un texto pegado por error no debe llegar al proveedor.
  const apiKeyCheck =
    hostedProvider && selectedApiKey ? checkApiKey(hostedProvider, selectedApiKey) : null;
  // Enmascarada no se ve qué se pegó: el ojo lo enseña.
  const apiKeyIssue = apiKeyCheck?.error
    ? `${apiKeyCheck.error} Con el ojo puedes ver qué se pegó.`
    : (apiKeyCheck?.warning ?? null);

  function changeApiKey(provider: "anthropic" | "openai", value: string) {
    const { key, removed } = normalizeApiKey(value);
    setSessionApiKey(provider, key);
    setKeyNote(removed.length ? `Se quitó ${removedList.format(removed)}: queda solo la clave.` : null);
  }

  function clearApiKey(provider: "anthropic" | "openai") {
    clearSessionApiKey(provider);
    setKeyNote(null);
    setRevealKey(false);
  }

  function updateModel(model: string) {
    setDraft((current) => ({
      ...current,
      models: { ...current.models, [current.provider]: model },
    }));
  }

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    saveAiSettings(draft);
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
          <Tag>IA · catálogo BYOK</Tag>
          <h2 id="ai-settings-title">Elige cómo catalogar tus documentos</h2>
          <p>
            Pliegue extrae el texto localmente y envía al proveedor seleccionado solo un
            extracto limitado con el nombre y la ruta relativa. Nunca envía el archivo binario
            completo en este flujo.
          </p>
        </div>
        <div className={styles.aiPrivacyStamp}>
          <span>Credencial</span>
          <strong>{draft.provider === "ollama" ? "No requerida" : "Solo esta sesión"}</strong>
          <small>Se elimina al recargar o cerrar la pestaña.</small>
        </div>
      </div>

      <form className={styles.aiSettingsForm} onSubmit={save}>
        <Field label="Proveedor principal" labelFor="ai-provider">
          <Select
            id="ai-provider"
            onChange={(event) => {
              setDraft((current) => ({
                ...current,
                provider: event.target.value as AiProvider,
              }));
              setKeyNote(null);
              setRevealKey(false);
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

        <Field label="Modelo" labelFor="ai-model">
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
          <>
            <Field label="Ubicación de Ollama" labelFor="ollama-mode">
              <Select
                id="ollama-mode"
                onChange={(event) => {
                  const mode = event.target.value as AiSettings["ollamaMode"];
                  setDraft((current) => ({
                    ...current,
                    ollamaMode: mode,
                    ollamaUrl:
                      mode === "local" ? defaultAiSettings.ollamaUrl : current.ollamaUrl,
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
                onChange={(event) =>
                  setDraft((current) => ({ ...current, ollamaUrl: event.target.value }))
                }
                placeholder="https://ollama.tudominio.com"
                type="url"
                value={draft.ollamaUrl}
              />
            </Field>
          </>
        ) : (
          <Field
            className={styles.aiSecretField}
            label={`API key de ${providerLabels[draft.provider]}`}
            labelFor="ai-api-key"
          >
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
                id="ai-api-key"
                name="pliegue-ai-session-key"
                onChange={(event) => changeApiKey(hostedProvider!, event.target.value)}
                placeholder="Pega una clave para esta sesión"
                spellCheck={false}
                type={textMask || revealKey ? "text" : "password"}
                value={selectedApiKey}
              />
              <IconButton
                aria-controls="ai-api-key"
                aria-pressed={revealKey}
                disabled={!selectedApiKey}
                icon={revealKey ? "eyeOff" : "eye"}
                label={revealKey ? "Ocultar la clave" : "Mostrar la clave"}
                onClick={() => setRevealKey((current) => !current)}
              />
              <Button
                disabled={!selectedApiKey}
                onClick={() => clearApiKey(hostedProvider!)}
                type="button"
                variant="danger"
              >
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
            ) : null}
          </Field>
        )}

        <Field label="Extracto máximo por archivo" labelFor="ai-excerpt">
          <Select
            id="ai-excerpt"
            onChange={(event) =>
              setDraft((current) => ({
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
              setDraft((current) => ({ ...current, concurrency: Number(event.target.value) }))
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
            setDraft((current) => ({
              ...current,
              autoAnalyzeAfterLink: event.target.checked,
            }))
          }
        />

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
          OpenAI y Anthropic reciben la clave y el extracto mediante la ruta de servidor de
          Pliegue, sin persistencia ni logs de contenido. Ollama se consulta directamente desde
          el navegador; una URL remota debe habilitar CORS para el origen de la app.
        </p>
      </div>
    </Card>
  );
}

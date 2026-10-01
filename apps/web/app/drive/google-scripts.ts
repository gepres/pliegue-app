/**
 * Las dos bibliotecas de Google que Drive necesita en el navegador, con los tipos mínimos que
 * usa Pliegue. Se cargan bajo demanda —nunca en páginas que no las usan— y una sola vez.
 */

export interface GoogleTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
  expires_in?: number | string;
  scope?: string;
}

export interface GoogleTokenClient {
  requestAccessToken(overrides?: { login_hint?: string; prompt?: string; scope?: string }): void;
}

export interface GoogleOAuth2 {
  hasGrantedAllScopes(response: GoogleTokenResponse, ...scopes: string[]): boolean;
  initTokenClient(config: {
    callback: (response: GoogleTokenResponse) => void;
    client_id: string;
    error_callback?: (error: { message?: string; type?: string }) => void;
    include_granted_scopes?: boolean;
    scope: string;
  }): GoogleTokenClient;
  revoke(token: string, done?: () => void): void;
}

export interface PickerDocument {
  driveId?: string;
  id: string;
  mimeType: string;
  name: string;
}

export interface PickerView {
  setEnableDrives(enabled: boolean): PickerView;
  setIncludeFolders(included: boolean): PickerView;
  setMimeTypes(mimeTypes: string): PickerView;
  setSelectFolderEnabled(enabled: boolean): PickerView;
}

export interface PickerBuilder {
  addView(view: PickerView): PickerBuilder;
  build(): { setVisible(visible: boolean): void };
  enableFeature(feature: string): PickerBuilder;
  setAppId(appId: string): PickerBuilder;
  setCallback(callback: (data: { action: string; docs?: PickerDocument[] }) => void): PickerBuilder;
  setDeveloperKey(key: string): PickerBuilder;
  setLocale(locale: string): PickerBuilder;
  setOAuthToken(token: string): PickerBuilder;
  setOrigin(origin: string): PickerBuilder;
  setTitle(title: string): PickerBuilder;
}

export interface GooglePicker {
  Action: { CANCEL: string; PICKED: string };
  DocsView: new (viewId?: string) => PickerView;
  Feature: { MULTISELECT_ENABLED: string; SUPPORT_DRIVES: string };
  PickerBuilder: new () => PickerBuilder;
  ViewId: { DOCS: string; FOLDERS: string };
}

interface GoogleWindow extends Window {
  gapi?: { load(name: string, callback: { callback: () => void; onerror: () => void } | (() => void)): void };
  google?: { accounts?: { oauth2?: GoogleOAuth2 }; picker?: GooglePicker };
}

export function googleWindow() {
  return window as GoogleWindow;
}

const scripts = new Map<string, Promise<void>>();

function loadScript(src: string) {
  const pending = scripts.get(src);
  if (pending) return pending;

  const loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.async = true;
    script.src = src;
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener(
      "error",
      () => {
        scripts.delete(src);
        script.remove();
        reject(new Error("No se pudo cargar Google. Revisa la conexión o si un bloqueador lo impide."));
      },
      { once: true },
    );
    document.head.append(script);
  });
  scripts.set(src, loading);
  return loading;
}

/** Google Identity Services: el cliente de tokens OAuth. */
export async function loadGoogleIdentity() {
  await loadScript("https://accounts.google.com/gsi/client");
  const oauth2 = googleWindow().google?.accounts?.oauth2;
  if (!oauth2) throw new Error("Google Identity Services no está disponible.");
  return oauth2;
}

let pickerLoading: Promise<GooglePicker> | null = null;

/** La API de Google Picker, que se carga a través de `gapi`. */
export function loadGooglePicker() {
  pickerLoading ??= loadScript("https://apis.google.com/js/api.js")
    .then(
      () =>
        new Promise<GooglePicker>((resolve, reject) => {
          const gapi = googleWindow().gapi;
          if (!gapi) return reject(new Error("La API de Google no está disponible."));
          gapi.load("picker", {
            callback: () => {
              const picker = googleWindow().google?.picker;
              if (picker) resolve(picker);
              else reject(new Error("Google Picker no está disponible."));
            },
            onerror: () => reject(new Error("No se pudo cargar Google Picker.")),
          });
        }),
    )
    .catch((error: unknown) => {
      pickerLoading = null;
      throw error;
    });
  return pickerLoading;
}

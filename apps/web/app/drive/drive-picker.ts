"use client";

import { publicConfig } from "../config/public-config";
import { driveFolderMimeType } from "./drive-files";
import { loadGooglePicker, type PickerDocument } from "./google-scripts";

export type DrivePickerMode = "files" | "folder";

/** Carga Google Picker de antemano, como la identidad: abrirlo no debe esperar descargas. */
export function preloadDrivePicker() {
  if (!publicConfig.drive) return;
  void loadGooglePicker().catch(() => undefined);
}

/**
 * Abre el selector de Google. En modo `files` se eligen varios libros (en Mi unidad, en
 * unidades compartidas o dentro de cualquier carpeta); en modo `folder`, una carpeta. Devuelve
 * lo elegido, o una lista vacía si se cierra sin elegir.
 *
 * `setAppId` con el número del proyecto es lo que hace que, con `drive.file`, los archivos
 * elegidos queden autorizados para Pliegue: sin él, la API responde 404 al leerlos.
 */
export async function openDrivePicker(mode: DrivePickerMode, token: string): Promise<PickerDocument[]> {
  const config = publicConfig.drive;
  if (!config) throw new Error("Esta instalación de Pliegue no tiene Google Drive configurado.");
  const picker = await loadGooglePicker();

  return new Promise<PickerDocument[]>((resolve) => {
    const myDrive = new picker.DocsView(mode === "folder" ? picker.ViewId.FOLDERS : picker.ViewId.DOCS).setIncludeFolders(true);
    const sharedDrives = new picker.DocsView(mode === "folder" ? picker.ViewId.FOLDERS : picker.ViewId.DOCS)
      .setEnableDrives(true)
      .setIncludeFolders(true);
    if (mode === "folder") {
      for (const view of [myDrive, sharedDrives]) view.setSelectFolderEnabled(true).setMimeTypes(driveFolderMimeType);
    }

    const builder = new picker.PickerBuilder()
      .setAppId(config.appId)
      .setDeveloperKey(config.apiKey)
      .setOAuthToken(token)
      .setOrigin(window.location.origin)
      .setLocale("es")
      .setTitle(mode === "folder" ? "Elige la carpeta de tu biblioteca" : "Elige los libros que quieres en Pliegue")
      .enableFeature(picker.Feature.SUPPORT_DRIVES)
      .addView(myDrive)
      .addView(sharedDrives)
      .setCallback((data) => {
        if (data.action === picker.Action.PICKED) resolve(data.docs ?? []);
        else if (data.action === picker.Action.CANCEL) resolve([]);
      });
    if (mode === "files") builder.enableFeature(picker.Feature.MULTISELECT_ENABLED);
    builder.build().setVisible(true);
  });
}

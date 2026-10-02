"use client";

import { useEffect, useRef } from "react";

import { useAiSettings } from "../../ai/ai-settings-store";
import { useAccount } from "../../cloud/account-store";
import {
  registerLocalSource,
  requestSync,
  useSyncChoices,
  type LocalSource,
} from "../../cloud/sync/sync-controller";
import { useAnnotationStore } from "../../library/annotation-store";
import { useFavorites } from "../../library/favorite-store";
import { useReadingProgressEntries } from "../../library/reading-progress-store";
import { useLibraryDocuments } from "../../library/use-library-documents";
import { usePreferences } from "../../preferences/preference-store";
import { useReaderView } from "../../preferences/reader-view-store";

/** Tras un cambio local, se espera un poco: una ráfaga de gestos se sube en una sola vuelta. */
const changeDelayMs = 3_000;
/** Lo que cambia en otros equipos llega en menos de un minuto (ADR-0002, gate 5). */
const pollMs = 45_000;

/**
 * Sin interfaz: lee los almacenes con sus hooks, se los ofrece al motor y decide cuándo
 * sincronizar —al entrar, tras cada cambio, cada 45 s con la ventana a la vista y al volver la
 * conexión—. Solo actúa con sesión y con la sincronización activada en este equipo.
 */
export function CloudSync() {
  const account = useAccount();
  const choices = useSyncChoices(account.userId);
  const library = useLibraryDocuments();
  const favorites = useFavorites();
  const progress = useReadingProgressEntries();
  const annotations = useAnnotationStore();
  const aiSettings = useAiSettings();
  const preferences = usePreferences();
  const readerView = useReaderView();

  const ready =
    !library.loading &&
    library.catalogs.status === "ready" &&
    library.importedCatalogs.status === "ready" &&
    annotations.status === "ready";

  const source = useRef<LocalSource | null>(null);
  useEffect(() => {
    source.current = {
      documents: library.baseDocuments,
      ready,
      snapshot: {
        aiSettings,
        annotations: annotations.annotations,
        catalogRecords: library.catalogs.records,
        favorites,
        importedCatalogs: library.importedCatalogs.records,
        progress,
      },
    };
  });

  useEffect(() => {
    registerLocalSource(() => source.current);
    return () => registerLocalSource(null);
  }, []);

  const active = account.status === "signed-in" && choices.enabled;

  // Cada cambio de lo que se sincroniza —y la propia activación— programa una vuelta.
  useEffect(() => {
    if (!active || !ready) return;
    const timer = window.setTimeout(() => void requestSync(), changeDelayMs);
    return () => window.clearTimeout(timer);
  }, [
    active,
    ready,
    aiSettings,
    annotations.annotations,
    favorites,
    library.baseDocuments,
    library.catalogs.records,
    library.importedCatalogs.records,
    preferences,
    progress,
    readerView,
    choices.catalogAi,
  ]);

  useEffect(() => {
    if (!active) return;
    // Comprobar si otro equipo cambió algo: no se anuncia como «Sincronizando…».
    function whenVisible() {
      if (document.visibilityState === "visible") void requestSync({ reason: "poll" });
    }
    const interval = window.setInterval(whenVisible, pollMs);
    document.addEventListener("visibilitychange", whenVisible);
    window.addEventListener("online", whenVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", whenVisible);
      window.removeEventListener("online", whenVisible);
    };
  }, [active]);

  return null;
}

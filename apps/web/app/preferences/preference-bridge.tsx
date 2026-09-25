"use client";

import { useEffect } from "react";

import { usePreferences } from "./preference-store";
import { useReaderView } from "./reader-view-store";

export function PreferenceBridge() {
  const { resolved } = usePreferences();
  const { measure } = useReaderView();

  useEffect(() => {
    const root = document.documentElement;

    if (resolved.theme === "system") root.removeAttribute("data-theme");
    else root.dataset.theme = resolved.theme;

    root.dataset.readerFont = resolved.readerFont;
    root.dataset.readerLineHeight = resolved.lineHeight;
    root.dataset.readerScale = String(resolved.readerScale);
    root.lang = resolved.language === "auto" ? "es" : resolved.language;
  }, [resolved]);

  useEffect(() => {
    document.documentElement.dataset.readerMeasure = measure;
  }, [measure]);

  return null;
}

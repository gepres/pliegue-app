"use client";

import { translationsChoice } from "../../library/forget-derivatives";
import { confirmAction, confirmWithChoice, type ConfirmOptions } from "../app-ui/confirm-dialog";

/**
 * El aviso antes de quitar libros de la biblioteca (desvincular una carpeta, unos archivos o
 * Drive, o eliminar una copia). Si tienen páginas traducidas, lleva el interruptor «Borrar
 * también sus traducciones», apagado de partida (03.3): por defecto se conservan.
 */
export async function confirmForgetting(options: ConfirmOptions, documentIds: readonly string[]) {
  const choice = await translationsChoice(documentIds);
  if (!choice) return { confirmed: await confirmAction(options), translations: false };
  const { chosen, confirmed } = await confirmWithChoice({ ...options, choice });
  return { confirmed, translations: chosen };
}

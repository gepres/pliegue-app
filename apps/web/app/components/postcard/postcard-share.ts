/**
 * Formas de sacar la postal de Pliegue. Todas las decide quien la comparte: la app no envía
 * nada por su cuenta.
 *
 * - El menú de compartir del sistema lleva la imagen a cualquier app instalada —Instagram,
 *   WhatsApp, Telegram, Facebook—. Es la vía principal en el móvil y, en Chrome y Edge, también
 *   en el escritorio.
 * - Los enlaces de WhatsApp, X y correo solo llevan texto: la web no permite adjuntar una
 *   imagen desde fuera. Sirven para mandar la cita y pegar después la imagen copiada.
 */

export const socialTargets = [
  {
    icon: "whatsapp",
    id: "whatsapp",
    label: "WhatsApp",
    url: (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`,
  },
  {
    icon: "xLogo",
    id: "x",
    label: "X",
    // X corta a 280: se deja margen para el enlace o la imagen que se añada.
    url: (text: string) => `https://twitter.com/intent/tweet?text=${encodeURIComponent(text.length > 270 ? `${text.slice(0, 269)}…` : text)}`,
  },
  {
    icon: "mail",
    id: "email",
    label: "Correo",
    url: (text: string, subject: string) =>
      `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`,
  },
] as const;

export function canShareFile(file: File) {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files: [file] })
  );
}

export function canCopyImage() {
  return typeof navigator !== "undefined" && Boolean(navigator.clipboard?.write) && typeof ClipboardItem !== "undefined";
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.download = fileName;
  anchor.href = url;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // El navegador necesita la URL hasta que empieza la descarga.
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function copyImageToClipboard(blob: Blob) {
  await navigator.clipboard.write([new ClipboardItem({ [blob.type || "image/png"]: blob })]);
}

export function openSocialTarget(url: string) {
  if (url.startsWith("mailto:")) {
    window.location.href = url;
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

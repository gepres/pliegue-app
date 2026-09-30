import type { CatalogCover, CatalogCoverSource } from "./catalog-import";
import type { DocumentFormat } from "./documents";

/**
 * La portada que Pliegue saca del propio archivo cuando ninguna ficha trae una: la primera
 * página del PDF, la imagen que el EPUB declara como portada o la imagen misma. Se genera al
 * indexar y se guarda con el índice, así que se paga una vez por versión del archivo y
 * mostrarla después no cuesta nada ni sale del dispositivo.
 *
 * Fuera del navegador —las pruebas, en Node— no hay canvas con el que dibujar: la función
 * devuelve `null` y el documento se indexa igual, con su portada tipográfica.
 */

/** El tamaño de las portadas del índice JSON: 300 × 450 como máximo, en WebP. */
const coverWidth = 300;
const coverHeight = 450;
const coverQuality = 0.72;

/** Dibujar la primera página obliga a cargar el PDF entero en memoria: por encima, se renuncia. */
export const maxCoverPdfBytes = 100 * 1024 * 1024;
const maxCoverImageBytes = 20 * 1024 * 1024;

/** Medidas que caben en 300 × 450 conservando la proporción. Una imagen pequeña no se amplía. */
export function fitCoverSize(width: number, height: number, allowUpscale: boolean) {
  const scale = Math.min(coverWidth / width, coverHeight / height, allowUpscale ? Infinity : 1);
  return {
    height: Math.max(1, Math.round(height * scale)),
    width: Math.max(1, Math.round(width * scale)),
  };
}

// ---- EPUB ---------------------------------------------------------------------------------

function readAttributes(tag: string) {
  const attributes = new Map<string, string>();
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const [, name, doubleQuoted, singleQuoted] = match;
    if (name) attributes.set(name.toLocaleLowerCase("en"), doubleQuoted ?? singleQuoted ?? "");
  }
  return attributes;
}

/** Une la ruta del OPF con un `href` relativo, resolviendo `..` y los escapes de URL. */
function resolveArchivePath(opfPath: string, href: string) {
  let decoded = href;
  try {
    decoded = decodeURIComponent(href);
  } catch {
    // Un `%` suelto en el nombre: se usa tal cual.
  }
  const parts = [...opfPath.split("/").slice(0, -1), ...(decoded.split("#")[0] ?? "").split("/")];
  const resolved: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") resolved.pop();
    else resolved.push(part);
  }
  return resolved.join("/");
}

/**
 * Ruta, dentro del EPUB, de la imagen de portada que declara su OPF. Se prueban las tres
 * formas que se ven en la práctica, de la más explícita a la más débil:
 *
 * 1. EPUB 3: el `item` con `properties="cover-image"`.
 * 2. EPUB 2: `<meta name="cover" content="ID">` apuntando al `item` de la imagen.
 * 3. Sin declaración: la imagen cuyo id o nombre dice «cover».
 */
export function findEpubCoverPath(opf: string, opfPath: string): string | null {
  const items = [...opf.matchAll(/<(?:opf:)?item\b[^>]*>/gi)].map((match) => readAttributes(match[0]));
  const isImage = (item: Map<string, string>) =>
    (item.get("media-type") ?? "").startsWith("image/") ||
    /\.(?:jpe?g|png|gif|webp)$/i.test(item.get("href") ?? "");

  let cover = items.find(
    (item) => isImage(item) && (item.get("properties") ?? "").split(/\s+/).includes("cover-image"),
  );

  if (!cover) {
    const meta = [...opf.matchAll(/<(?:opf:)?meta\b[^>]*>/gi)]
      .map((match) => readAttributes(match[0]))
      .find((attributes) => attributes.get("name")?.toLocaleLowerCase("en") === "cover");
    const coverId = meta?.get("content");
    if (coverId) cover = items.find((item) => item.get("id") === coverId && isImage(item));
  }

  cover ??= items.find(
    (item) => isImage(item) && /cover|portada/i.test(`${item.get("id") ?? ""} ${item.get("href") ?? ""}`),
  );

  const href = cover?.get("href");
  return href ? resolveArchivePath(opfPath, href) : null;
}

const imageTypes: Record<string, string> = {
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

type Unzip = typeof import("fflate").unzip;

function unzipSelected(unzip: Unzip, data: Uint8Array, wanted: (name: string, size: number) => boolean) {
  return new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(data, { filter: (file) => wanted(file.name, file.originalSize) }, (error, files) => {
      if (error) reject(error);
      else resolve(files);
    });
  });
}

/**
 * La imagen de portada de un EPUB sin descomprimir el libro: una pasada lee solo el
 * `container.xml` y el OPF, y otra solo la imagen elegida.
 */
export async function readEpubCoverImage(file: Blob): Promise<Blob | null> {
  const [{ unzip }, buffer] = await Promise.all([import("fflate"), file.arrayBuffer()]);
  const data = new Uint8Array(buffer);
  const decoder = new TextDecoder("utf-8", { fatal: false });

  const texts = await unzipSelected(
    unzip,
    data,
    (name, size) => size <= 2 * 1024 * 1024 && (/^META-INF\/container\.xml$/i.test(name) || /\.opf$/i.test(name)),
  );
  const container = Object.entries(texts).find(([name]) => /container\.xml$/i.test(name))?.[1];
  const declaredOpf = container ? /full-path\s*=\s*"([^"]+)"/i.exec(decoder.decode(container))?.[1] : undefined;
  const opfPath = declaredOpf ?? Object.keys(texts).find((name) => /\.opf$/i.test(name));
  const opf = opfPath ? texts[opfPath] : undefined;
  if (!opfPath || !opf) return null;

  const coverPath = findEpubCoverPath(decoder.decode(opf), opfPath);
  if (!coverPath) return null;

  const wantedName = coverPath.toLocaleLowerCase("en");
  const images = await unzipSelected(
    unzip,
    data,
    (name, size) => size <= maxCoverImageBytes && name.toLocaleLowerCase("en") === wantedName,
  );
  const bytes = Object.values(images)[0];
  if (!bytes) return null;

  const extension = /\.([a-z]+)$/i.exec(coverPath)?.[1]?.toLocaleLowerCase("en") ?? "";
  // Copia a un ArrayBuffer propio: la vista de fflate puede apuntar a un búfer compartido.
  return new Blob([bytes.slice()], { type: imageTypes[extension] ?? "application/octet-stream" });
}

// ---- Dibujo ---------------------------------------------------------------------------------

function canDraw() {
  return (
    typeof document !== "undefined" &&
    typeof createImageBitmap === "function" &&
    typeof FileReader !== "undefined"
  );
}

function createCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function blobToDataUri(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)), { once: true });
    reader.addEventListener("error", () => reject(reader.error), { once: true });
    reader.readAsDataURL(blob);
  });
}

async function canvasToCover(canvas: HTMLCanvasElement, source: CatalogCoverSource): Promise<CatalogCover | null> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", coverQuality));
  if (!blob) return null;
  return { height: canvas.height, source, src: await blobToDataUri(blob), width: canvas.width };
}

async function drawImageCover(image: Blob, source: CatalogCoverSource) {
  const bitmap = await createImageBitmap(image);

  try {
    const { height, width } = fitCoverSize(bitmap.width, bitmap.height, false);
    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, width, height);
    return await canvasToCover(canvas, source);
  } finally {
    bitmap.close();
  }
}

async function renderPdfCover(file: Blob) {
  if (file.size > maxCoverPdfBytes) return null;

  // Con la intención `display`: la de `text` no carga fuentes ni decodificadores de imagen y
  // la página saldría en blanco, justo en los escaneos, donde la portada es una imagen.
  const { openPdfDocument } = await import("./pdf-runtime");
  const { close, document: pdf } = await openPdfDocument(new Uint8Array(await file.arrayBuffer()), "display");

  try {
    const page = await pdf.getPage(1);

    try {
      const base = page.getViewport({ scale: 1 });
      const { width } = fitCoverSize(base.width, base.height, true);
      const viewport = page.getViewport({ scale: width / base.width });
      const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height));
      await page.render({ canvas, viewport }).promise;
      return await canvasToCover(canvas, "pdf-page");
    } finally {
      page.cleanup();
    }
  } finally {
    await close();
  }
}

export async function createDocumentCover(format: DocumentFormat, file: Blob): Promise<CatalogCover | null> {
  if (!canDraw()) return null;

  try {
    if (format === "pdf") return await renderPdfCover(file);
    if (format === "epub") {
      const image = await readEpubCoverImage(file);
      return image ? await drawImageCover(image, "epub") : null;
    }
    if ((format === "png" || format === "jpg") && file.size <= maxCoverImageBytes) {
      return await drawImageCover(file, "other");
    }
    return null;
  } catch {
    // Un PDF protegido o un EPUB con la portada rota no son un fallo del documento: se queda
    // con la portada tipográfica y el índice de texto sigue adelante.
    return null;
  }
}

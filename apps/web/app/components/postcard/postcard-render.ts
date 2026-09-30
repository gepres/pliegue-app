import {
  attributionParts,
  coverCrop,
  fitText,
  postcardFilters,
  postcardFormats,
  postcardTemplates,
  type PostcardContent,
  type PostcardDesign,
  type PostcardFont,
  type PostcardTexture,
} from "./postcard-model";

/**
 * Dibujo de la postal sobre un canvas, a la resolución final. La vista previa es este mismo
 * canvas escalado por CSS: lo que se ve es exactamente lo que se comparte.
 *
 * Las fuentes son las de la app (servidas por @fontsource desde el propio origen), así que
 * dibujar no pide nada a la red.
 */

const fonts: Record<PostcardFont, { family: string; lineHeight: number; weight: number }> = {
  display: { family: '"Cormorant Garamond", Georgia, serif', lineHeight: 1.18, weight: 600 },
  reading: { family: '"Source Serif 4", Georgia, serif', lineHeight: 1.42, weight: 400 },
  sans: { family: "Inter, system-ui, sans-serif", lineHeight: 1.36, weight: 500 },
};
const uiFont = "Inter, system-ui, sans-serif";
const brandFont = '"Cormorant Garamond", Georgia, serif';

export interface PostcardAssets {
  background: ImageBitmap | null;
  image: ImageBitmap | null;
}

export async function loadPostcardAssets(content: PostcardContent, design: PostcardDesign): Promise<PostcardAssets> {
  const [image, background] = await Promise.all([
    content.image ? createImageBitmap(content.image).catch(() => null) : null,
    design.backgroundImage ? createImageBitmap(design.backgroundImage).catch(() => null) : null,
  ]);
  return { background, image };
}

/** Las fuentes deben estar cargadas antes de medir: si no, el texto se mide con la de reserva. */
export async function ensurePostcardFonts(design: PostcardDesign) {
  if (typeof document === "undefined" || !document.fonts) return;
  const font = fonts[design.font];
  await Promise.all([
    document.fonts.load(`${font.weight} 64px ${font.family}`),
    document.fonts.load(`500 28px ${uiFont}`),
    document.fonts.load(`400 28px ${uiFont}`),
    document.fonts.load(`600 40px ${brandFont}`),
  ]).catch(() => undefined);
}

const supportsCanvasFilter =
  typeof CanvasRenderingContext2D !== "undefined" && "filter" in CanvasRenderingContext2D.prototype;

// ---- Texturas --------------------------------------------------------------------------

/** Generador pseudoaleatorio con semilla: la misma textura en cada dibujo, sin parpadeos. */
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const textureCache = new Map<PostcardTexture, HTMLCanvasElement>();

function textureTile(texture: Exclude<PostcardTexture, "none">) {
  const cached = textureCache.get(texture);
  if (cached) return cached;
  const size = 256;
  const tile = document.createElement("canvas");
  tile.width = size;
  tile.height = size;
  const context = tile.getContext("2d");
  if (!context) return tile;
  const next = random(texture === "paper" ? 7 : 13);
  const pixels = context.createImageData(size, size);

  for (let index = 0; index < pixels.data.length; index += 4) {
    const tone = texture === "paper" ? 150 + next() * 105 : next() * 255;
    pixels.data[index] = tone;
    pixels.data[index + 1] = tone;
    pixels.data[index + 2] = tone;
    pixels.data[index + 3] = texture === "paper" ? 28 + next() * 30 : 34 + next() * 26;
  }
  context.putImageData(pixels, 0, 0);

  if (texture === "paper") {
    // Fibras: trazos cortos y claros, como las del papel de libro.
    context.lineCap = "round";
    for (let fiber = 0; fiber < 70; fiber += 1) {
      context.strokeStyle = `rgb(255 255 255 / ${0.15 + next() * 0.2})`;
      context.lineWidth = 0.6 + next() * 0.8;
      const x = next() * size;
      const y = next() * size;
      context.beginPath();
      context.moveTo(x, y);
      context.quadraticCurveTo(x + (next() - 0.5) * 18, y + (next() - 0.5) * 18, x + (next() - 0.5) * 28, y + (next() - 0.5) * 28);
      context.stroke();
    }
  }

  textureCache.set(texture, tile);
  return tile;
}

function paintTexture(context: CanvasRenderingContext2D, texture: PostcardTexture, width: number, height: number) {
  if (texture === "none") return;
  const pattern = context.createPattern(textureTile(texture), "repeat");
  if (!pattern) return;
  context.save();
  context.globalCompositeOperation = "overlay";
  context.globalAlpha = texture === "paper" ? 0.55 : 0.4;
  context.fillStyle = pattern;
  context.fillRect(0, 0, width, height);
  context.restore();
}

// ---- Piezas ----------------------------------------------------------------------------

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

interface Box {
  height: number;
  width: number;
  x: number;
  y: number;
}

function drawCover(
  context: CanvasRenderingContext2D,
  image: ImageBitmap,
  box: Box,
  focal: { x: number; y: number },
  filter: string,
) {
  const crop = coverCrop(image, box, focal);
  context.save();
  if (supportsCanvasFilter) context.filter = filter;
  context.drawImage(image, crop.sx, crop.sy, crop.sw, crop.sh, box.x, box.y, box.width, box.height);
  context.restore();
  return crop;
}

function filterFor(design: PostcardDesign, withBlur: boolean) {
  const parts: string[] = [postcardFilters[design.filter].css].filter((part) => part !== "none");
  if (withBlur && design.blur > 0) parts.push(`blur(${design.blur}px)`);
  return parts.length ? parts.join(" ") : "none";
}

export interface PostcardRenderResult {
  /** Dónde quedó la imagen recortada y qué parte de ella se ve: para fijar el punto focal. */
  image: { box: Box; crop: { sh: number; sw: number; sx: number; sy: number }; natural: { height: number; width: number } } | null;
  truncated: boolean;
}

export function renderPostcard(
  canvas: HTMLCanvasElement,
  content: PostcardContent,
  design: PostcardDesign,
  assets: PostcardAssets,
): PostcardRenderResult {
  const format = postcardFormats[design.format];
  const { height, width } = format;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return { image: null, truncated: false };

  const template = postcardTemplates[design.template];
  const unit = Math.min(width, height) / 1080;
  const landscape = design.format === "landscape";
  const pad = Math.round((landscape ? 64 : 92) * unit);
  const quote = design.showQuote ? content.quote.trim() : "";
  const image = design.showImage ? assets.image : null;
  const photoBackground = Boolean(assets.background) || (image !== null && design.imageLayout === "background");
  const colors = photoBackground
    ? { accent: template.accent, muted: "rgb(255 255 255 / 80%)", text: "#ffffff" }
    : { accent: template.accent, muted: template.muted, text: template.text };
  let result: PostcardRenderResult = { image: null, truncated: false };

  context.clearRect(0, 0, width, height);
  context.textBaseline = "alphabetic";

  // ---- 1. Fondo -------------------------------------------------------------------------
  if (design.backgroundColor) {
    context.fillStyle = design.backgroundColor;
  } else if (template.background.length === 2) {
    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, template.background[0]);
    gradient.addColorStop(1, template.background[1]);
    context.fillStyle = gradient;
  } else {
    context.fillStyle = template.background[0];
  }
  context.fillRect(0, 0, width, height);

  const full = { height, width, x: 0, y: 0 };
  if (assets.background) {
    drawCover(context, assets.background, full, { x: 0.5, y: 0.5 }, filterFor(design, true));
  } else if (image && design.imageLayout === "background") {
    const crop = drawCover(context, image, full, { x: design.focalX, y: design.focalY }, filterFor(design, true));
    result = { image: { box: full, crop, natural: { height: image.height, width: image.width } }, truncated: false };
  }
  if (photoBackground) {
    // Capa de legibilidad: más densa abajo, donde va el texto, sin apagar la foto entera.
    const scrim = context.createLinearGradient(0, 0, 0, height);
    scrim.addColorStop(0, `rgb(0 0 0 / ${design.scrim * 0.55})`);
    scrim.addColorStop(1, `rgb(0 0 0 / ${Math.min(0.92, design.scrim * 1.25)})`);
    context.fillStyle = scrim;
    context.fillRect(0, 0, width, height);
  }

  paintTexture(context, design.texture, width, height);

  // ---- 2. Imagen arriba o enmarcada ------------------------------------------------------
  let textBox: Box = { height: height - pad * 2, width: width - pad * 2, x: pad, y: pad };

  if (image && design.imageLayout !== "background") {
    const gap = Math.round(44 * unit);
    let box: Box;
    if (landscape && quote) {
      box = { height: height - pad * 2, width: Math.round((width - pad * 2 - gap) * 0.5), x: pad, y: pad };
      textBox = { height: height - pad * 2, width: width - pad * 2 - box.width - gap, x: pad + box.width + gap, y: pad };
    } else {
      const share = quote ? (design.format === "story" ? 0.5 : 0.56) : 0.8;
      box = { height: Math.round((height - pad * 2) * share), width: width - pad * 2, x: pad, y: pad };
      textBox = { height: height - pad * 2 - box.height - gap, width: width - pad * 2, x: pad, y: pad + box.height + gap };
    }

    if (design.imageLayout === "framed") {
      // Enmarcada: la página entera, sin recortar, sobre un paspartú claro.
      const border = Math.round(22 * unit);
      const scale = Math.min((box.width - border * 2) / image.width, (box.height - border * 2) / image.height);
      const drawn = { height: image.height * scale, width: image.width * scale };
      const frame = {
        height: drawn.height + border * 2,
        width: drawn.width + border * 2,
        x: box.x + (box.width - drawn.width - border * 2) / 2,
        y: box.y + (box.height - drawn.height - border * 2) / 2,
      };
      context.save();
      context.shadowBlur = 40 * unit;
      context.shadowColor = "rgb(0 0 0 / 22%)";
      context.shadowOffsetY = 14 * unit;
      context.fillStyle = "#fffdf8";
      roundedRect(context, frame.x, frame.y, frame.width, frame.height, 10 * unit);
      context.fill();
      context.restore();
      const inner = { height: drawn.height, width: drawn.width, x: frame.x + border, y: frame.y + border };
      context.save();
      if (supportsCanvasFilter) context.filter = filterFor(design, false);
      context.drawImage(image, inner.x, inner.y, inner.width, inner.height);
      context.restore();
      result = {
        image: { box: inner, crop: { sh: image.height, sw: image.width, sx: 0, sy: 0 }, natural: { height: image.height, width: image.width } },
        truncated: false,
      };
    } else {
      context.save();
      context.shadowBlur = 36 * unit;
      context.shadowColor = "rgb(0 0 0 / 18%)";
      context.shadowOffsetY = 10 * unit;
      roundedRect(context, box.x, box.y, box.width, box.height, 28 * unit);
      context.fillStyle = "#000";
      context.fill();
      context.restore();
      context.save();
      roundedRect(context, box.x, box.y, box.width, box.height, 28 * unit);
      context.clip();
      const crop = drawCover(context, image, box, { x: design.focalX, y: design.focalY }, filterFor(design, false));
      context.restore();
      result = { image: { box, crop, natural: { height: image.height, width: image.width } }, truncated: false };
    }
  }

  // ---- 3. Referencia y marca, abajo -----------------------------------------------------
  const { author, page, title } = attributionParts(content, design);
  const reference = [title, page].filter(Boolean).join(" · ");
  const referenceSize = Math.round(27 * unit);
  const authorSize = Math.round(31 * unit);
  const brandSize = Math.round(34 * unit);
  const referenceLines = (author ? 1 : 0) + (reference ? 1 : 0);
  const footer = referenceLines ? Math.round(referenceLines * 40 * unit + 36 * unit) : 0;
  const brandSpace = design.showBrand ? Math.round(56 * unit) : 0;
  const center = design.align === "center";
  const anchorX = (box: Box) => (center ? box.x + box.width / 2 : box.x);
  context.textAlign = center ? "center" : "left";

  // ---- 4. Cita ----------------------------------------------------------------------------
  const quoteBox: Box = {
    height: textBox.height - footer - brandSpace,
    width: textBox.width,
    x: textBox.x,
    y: textBox.y,
  };

  if (quote && quoteBox.height > 60 * unit) {
    const font = fonts[design.font];
    const markSize = Math.round((image ? 110 : 170) * unit);
    const markSpace = Math.round(markSize * 0.52);
    context.font = `${fonts.display.weight} ${markSize}px ${fonts.display.family}`;
    const bodyBox = { ...quoteBox, height: quoteBox.height - markSpace, y: quoteBox.y + markSpace };
    const measure = (text: string, size: number) => {
      context.font = `${font.weight} ${size}px ${font.family}`;
      return context.measureText(text).width;
    };
    const base = (design.format === "story" ? 78 : landscape ? 54 : 70) * unit * design.textScale;
    const fitted = fitText(measure, quote, bodyBox, {
      lineHeight: font.lineHeight,
      maxSize: Math.round(base * (image ? 0.8 : 1)),
      minSize: Math.round(24 * unit * design.textScale),
    });
    const blockHeight = fitted.lines.length * fitted.lineHeight;
    const top = bodyBox.y + Math.max(0, (bodyBox.height - blockHeight) / 2);

    // Comillas de apertura, en el color de acento, colgadas sobre el bloque.
    context.fillStyle = colors.accent;
    context.font = `${fonts.display.weight} ${markSize}px ${fonts.display.family}`;
    context.fillText("“", anchorX(quoteBox), top - fitted.lineHeight * 0.18 + markSize * 0.25);

    context.fillStyle = colors.text;
    context.font = `${font.weight} ${fitted.fontSize}px ${font.family}`;
    fitted.lines.forEach((line, index) => {
      context.fillText(line, anchorX(bodyBox), top + fitted.lineHeight * (index + 0.8));
    });
    result = { ...result, truncated: fitted.truncated };
  }

  if (referenceLines) {
    let y = textBox.y + textBox.height - brandSpace - footer + Math.round(20 * unit);
    context.fillStyle = colors.accent;
    const ruleWidth = Math.round(56 * unit);
    context.fillRect(center ? anchorX(textBox) - ruleWidth / 2 : textBox.x, y, ruleWidth, Math.max(2, Math.round(3 * unit)));
    y += Math.round(44 * unit);
    if (author) {
      context.fillStyle = colors.text;
      context.font = `500 ${authorSize}px ${uiFont}`;
      context.fillText(author, anchorX(textBox), y, textBox.width);
      y += Math.round(40 * unit);
    }
    if (reference) {
      context.fillStyle = colors.muted;
      context.font = `400 ${referenceSize}px ${uiFont}`;
      context.fillText(reference, anchorX(textBox), y, textBox.width);
    }
  }

  if (design.showBrand) {
    context.fillStyle = colors.muted;
    context.globalAlpha = 0.85;
    context.font = `600 ${brandSize}px ${brandFont}`;
    context.textAlign = center ? "center" : "right";
    context.fillText("Pliegue", center ? width / 2 : width - pad, height - pad + Math.round(8 * unit));
    context.globalAlpha = 1;
  }

  return result;
}

export function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("No se pudo crear la imagen."))), "image/png");
  });
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button, Field, Select, Switch, buttonClassName, cx } from "@pliegue/ui";

import { IconButton, Segmented } from "../app-ui/controls";
import { Icon } from "../app-ui/icons";
import {
  countWords,
  defaultPostcardDesign,
  isLongQuote,
  postcardFileName,
  postcardFilterOrder,
  postcardFilters,
  postcardFontLabels,
  postcardFormatOrder,
  postcardFormats,
  postcardImageLayoutLabels,
  postcardShareText,
  postcardTemplateOrder,
  postcardTemplates,
  postcardTextureLabels,
  shortQuoteWords,
  shortenQuote,
  type PostcardContent,
  type PostcardDesign,
  type PostcardFilter,
} from "./postcard-model";
import {
  canvasToBlob,
  ensurePostcardFonts,
  loadPostcardAssets,
  renderPostcard,
  type PostcardAssets,
  type PostcardRenderResult,
} from "./postcard-render";
import {
  canCopyImage,
  canShareFile,
  copyImageToClipboard,
  downloadBlob,
  openSocialTarget,
  socialTargets,
} from "./postcard-share";
import styles from "./postcard.module.css";

/** Lo que se recuerda entre postales: el gusto, no el contenido. */
const memoryKey = "pliegue-postcard-design";

function readRemembered(): Partial<PostcardDesign> {
  try {
    return JSON.parse(window.localStorage.getItem(memoryKey) ?? "{}") as Partial<PostcardDesign>;
  } catch {
    return {};
  }
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Etiqueta para un control segmentado: no es un campo al que apuntar con `htmlFor`. */
function Control({ children, hint, label }: { children: React.ReactNode; hint?: string; label: string }) {
  return (
    <div className={styles.control}>
      <span className={styles.controlLabel}>{label}</span>
      {children}
      {hint ? <p className={styles.controlHint}>{hint}</p> : null}
    </div>
  );
}

/**
 * Editor de postales: el fragmento —una cita, un recorte de la página o los dos— convertido
 * en una imagen lista para compartir.
 *
 * Lo que se ve en la vista previa es el canvas final escalado: no hay una maqueta en HTML y
 * otra en la exportación que puedan no coincidir.
 */
export function PostcardEditor({ content, onClose }: { content: PostcardContent; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [quote, setQuote] = useState(content.quote);
  const [design, setDesign] = useState<PostcardDesign>(() => defaultPostcardDesign(content, readRemembered()));
  const [assets, setAssets] = useState<PostcardAssets>({ background: null, image: null });
  const [rendered, setRendered] = useState<PostcardRenderResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const panRef = useRef<{ focalX: number; focalY: number; x: number; y: number } | null>(null);

  const liveContent = useMemo(() => ({ ...content, quote }), [content, quote]);
  const update = useCallback(<Key extends keyof PostcardDesign>(key: Key, value: PostcardDesign[Key]) => {
    setDesign((current) => ({ ...current, [key]: value }));
  }, []);

  // ---- Abrir como diálogo modal -------------------------------------------------------
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  // ---- Recordar el gusto --------------------------------------------------------------
  useEffect(() => {
    try {
      window.localStorage.setItem(
        memoryKey,
        JSON.stringify({ font: design.font, format: design.format, showBrand: design.showBrand, template: design.template }),
      );
    } catch {
      // Sin almacenamiento, la próxima postal empieza con los valores de siempre.
    }
  }, [design.font, design.format, design.showBrand, design.template]);

  // ---- Imágenes decodificadas ---------------------------------------------------------
  const backgroundImage = design.backgroundImage;
  useEffect(() => {
    let cancelled = false;
    void loadPostcardAssets(content, { ...design, backgroundImage }).then((next) => {
      if (!cancelled) setAssets(next);
    });
    return () => {
      cancelled = true;
    };
    // Solo las imágenes deciden la carga; el resto del diseño se aplica al dibujar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backgroundImage, content]);

  // ---- Dibujo -------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      void ensurePostcardFonts(design).then(() => {
        const canvas = canvasRef.current;
        if (cancelled || !canvas) return;
        setRendered(renderPostcard(canvas, liveContent, design, assets));
      });
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [assets, design, liveContent]);

  // ---- Encuadre: arrastrar la imagen mueve el punto focal ------------------------------
  const pannable = Boolean(rendered?.image) && design.imageLayout !== "framed" && !design.backgroundImage;

  function canvasPoint(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function startPan(event: React.PointerEvent<HTMLCanvasElement>) {
    const info = rendered?.image;
    if (!pannable || !info) return;
    const point = canvasPoint(event);
    const { box } = info;
    if (point.x < box.x || point.x > box.x + box.width || point.y < box.y || point.y > box.y + box.height) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    panRef.current = { focalX: design.focalX, focalY: design.focalY, ...point };
  }

  function movePan(event: React.PointerEvent<HTMLCanvasElement>) {
    const start = panRef.current;
    const info = rendered?.image;
    if (!start || !info) return;
    const point = canvasPoint(event);
    const { box, crop, natural } = info;
    // Arrastrar a la derecha descubre lo que hay a la izquierda, como al mover una foto.
    const focalX = clamp01(start.focalX - ((point.x - start.x) / box.width) * (crop.sw / natural.width));
    const focalY = clamp01(start.focalY - ((point.y - start.y) / box.height) * (crop.sh / natural.height));
    setDesign((current) => ({ ...current, focalX, focalY }));
  }

  function endPan() {
    panRef.current = null;
  }

  // ---- Compartir ------------------------------------------------------------------------
  const fileName = postcardFileName(content);
  const shareText = postcardShareText(liveContent, design);
  const shareSupported = useMemo(
    () => canShareFile(new File([new Blob([""], { type: "image/png" })], "postal.png", { type: "image/png" })),
    [],
  );
  const copySupported = useMemo(() => canCopyImage(), []);

  async function exportImage() {
    const canvas = canvasRef.current;
    if (!canvas) throw new Error("Sin lienzo.");
    await ensurePostcardFonts(design);
    renderPostcard(canvas, liveContent, design, assets);
    return canvasToBlob(canvas);
  }

  async function run(action: () => Promise<string | null>) {
    setBusy(true);
    setMessage(null);
    try {
      const done = await action();
      if (done) setMessage(done);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setMessage("No fue posible completar la acción en este navegador.");
    } finally {
      setBusy(false);
    }
  }

  const share = () =>
    run(async () => {
      const blob = await exportImage();
      const file = new File([blob], fileName, { type: "image/png" });
      if (canShareFile(file)) {
        await navigator.share({ files: [file], text: shareText, title: content.title });
        return "Postal compartida.";
      }
      downloadBlob(blob, fileName);
      return "Este navegador no comparte archivos: la postal se descargó.";
    });

  const download = () =>
    run(async () => {
      downloadBlob(await exportImage(), fileName);
      return `Descargada como ${fileName}.`;
    });

  const copyImage = () =>
    run(async () => {
      await copyImageToClipboard(await exportImage());
      return "Imagen copiada: pégala en el chat o la red que quieras.";
    });

  const copyText = () =>
    run(async () => {
      await navigator.clipboard.writeText(shareText);
      return "Texto copiado: la cita con su referencia.";
    });

  // ---- Estado derivado ------------------------------------------------------------------
  const template = postcardTemplates[design.template];
  const hasImage = Boolean(content.image);
  const photoBackground = Boolean(design.backgroundImage) || (hasImage && design.showImage && design.imageLayout === "background");
  const longQuote = design.showQuote && isLongQuote(quote);
  const format = postcardFormats[design.format];

  return (
    <dialog
      aria-labelledby="postcard-title"
      className={styles.dialog}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      ref={dialogRef}
    >
      <div className={styles.layout}>
        <div className={styles.stage} data-pannable={pannable ? "true" : undefined}>
          <canvas
            aria-label={`Vista previa de la postal, ${format.label.toLocaleLowerCase("es")}`}
            className={styles.canvas}
            onPointerCancel={endPan}
            onPointerDown={startPan}
            onPointerMove={movePan}
            onPointerUp={endPan}
            ref={canvasRef}
            role="img"
          />
          {pannable ? <p className={styles.stageHint}>Arrastra la imagen para encuadrarla</p> : null}
        </div>

        <div className={styles.controls}>
          <header className={styles.header}>
            <div>
              <h2 id="postcard-title">Crear postal</h2>
              <p>{content.title}{content.page !== null ? ` · página ${content.page}` : ""}</p>
            </div>
            <IconButton icon="close" label="Cerrar" onClick={onClose} />
          </header>

          <div className={styles.body}>
            {/* ---- Diseño ---- */}
            <section aria-labelledby="postcard-design" className={styles.group}>
              <h3 id="postcard-design">Diseño</h3>
              <div aria-label="Plantilla" className={styles.templates} role="radiogroup">
                {postcardTemplateOrder.map((id) => {
                  const item = postcardTemplates[id];
                  const background =
                    item.background.length === 2
                      ? `linear-gradient(135deg, ${item.background[0]}, ${item.background[1]})`
                      : item.background[0];
                  return (
                    <button
                      aria-checked={design.template === id}
                      className={styles.template}
                      key={id}
                      onClick={() =>
                        setDesign((current) => ({
                          ...current,
                          backgroundColor: null,
                          font: postcardTemplates[id].font,
                          template: id,
                          texture: postcardTemplates[id].texture,
                        }))
                      }
                      role="radio"
                      type="button"
                    >
                      <span className={styles.templateSwatch} style={{ background, color: item.text }}>
                        <span style={{ color: item.accent }}>“</span>Aa
                      </span>
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
              <Control hint={format.hint} label="Formato">
                <Segmented
                  label="Formato"
                  onChange={(value) => update("format", value)}
                  options={postcardFormatOrder.map((id) => ({ label: postcardFormats[id].label, value: id }))}
                  size="sm"
                  value={design.format}
                />
              </Control>
            </section>

            {/* ---- Texto ---- */}
            <section aria-labelledby="postcard-text" className={styles.group}>
              <h3 id="postcard-text">Texto</h3>
              {hasImage ? (
                <Switch checked={design.showQuote} label="Mostrar la cita" onChange={(event) => update("showQuote", event.target.checked)} />
              ) : null}
              {design.showQuote ? (
                <>
                  <Field
                    description={`${countWords(quote)} palabras · cita breve hasta ${shortQuoteWords}`}
                    label="Cita"
                    labelFor="postcard-quote"
                  >
                    <textarea
                      className={cx("pliegue-input", styles.quote)}
                      id="postcard-quote"
                      onChange={(event) => setQuote(event.target.value)}
                      placeholder="Escribe o pega el fragmento"
                      rows={4}
                      value={quote}
                    />
                  </Field>
                  {longQuote ? (
                    <div className={styles.rights} role="status">
                      <p>
                        Es una cita larga. Para compartir con respeto a los derechos de autor, usa un
                        fragmento breve y con su referencia.
                      </p>
                      <Button onClick={() => setQuote(shortenQuote(quote))} size="sm" variant="secondary">
                        Acortar a {shortQuoteWords} palabras
                      </Button>
                    </div>
                  ) : null}
                  {rendered?.truncated ? (
                    <p className={styles.note} role="status">
                      La cita no cabe entera: acórtala, baja el tamaño o elige un formato más alto.
                    </p>
                  ) : null}
                  <Control label="Tipografía">
                    <Segmented
                      label="Tipografía"
                      onChange={(value) => update("font", value)}
                      options={(["display", "reading", "sans"] as const).map((id) => ({ label: postcardFontLabels[id], value: id }))}
                      size="sm"
                      value={design.font}
                    />
                  </Control>
                  <div className={styles.row}>
                    <Control label="Alineación">
                      <Segmented
                        label="Alineación"
                        onChange={(value) => update("align", value)}
                        options={[
                          { label: "Centro", value: "center" as const },
                          { label: "Izquierda", value: "start" as const },
                        ]}
                        size="sm"
                        value={design.align}
                      />
                    </Control>
                    <Field label={`Tamaño · ${Math.round(design.textScale * 100)} %`} labelFor="postcard-size">
                      <input
                        className={styles.range}
                        id="postcard-size"
                        max={1.4}
                        min={0.7}
                        onChange={(event) => update("textScale", Number(event.target.value))}
                        step={0.05}
                        type="range"
                        value={design.textScale}
                      />
                    </Field>
                  </div>
                </>
              ) : null}
            </section>

            {/* ---- Imagen ---- */}
            {hasImage ? (
              <section aria-labelledby="postcard-image" className={styles.group}>
                <h3 id="postcard-image">Recorte</h3>
                <Switch checked={design.showImage} label="Mostrar el recorte" onChange={(event) => update("showImage", event.target.checked)} />
                {design.showImage ? (
                  <>
                    <Control label="Colocación">
                      <Segmented
                        label="Colocación del recorte"
                        onChange={(value) => update("imageLayout", value)}
                        options={(["top", "background", "framed"] as const).map((id) => ({ label: postcardImageLayoutLabels[id], value: id }))}
                        size="sm"
                        value={design.imageLayout}
                      />
                    </Control>
                    <div className={styles.row}>
                      <Field label="Filtro" labelFor="postcard-filter">
                        <Select id="postcard-filter" onChange={(event) => update("filter", event.target.value as PostcardFilter)} value={design.filter}>
                          {postcardFilterOrder.map((id) => (
                            <option key={id} value={id}>
                              {postcardFilters[id].label}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      {design.imageLayout === "background" ? (
                        <Field label={`Desenfoque · ${design.blur} px`} labelFor="postcard-blur">
                          <input
                            className={styles.range}
                            id="postcard-blur"
                            max={24}
                            min={0}
                            onChange={(event) => update("blur", Number(event.target.value))}
                            step={1}
                            type="range"
                            value={design.blur}
                          />
                        </Field>
                      ) : null}
                    </div>
                  </>
                ) : null}
              </section>
            ) : null}

            {/* ---- Fondo ---- */}
            <section aria-labelledby="postcard-background" className={styles.group}>
              <h3 id="postcard-background">Fondo</h3>
              <div className={styles.backgroundActions}>
                <label className={styles.colorField}>
                  <input
                    aria-label="Color de fondo propio"
                    onChange={(event) => update("backgroundColor", event.target.value)}
                    type="color"
                    value={design.backgroundColor ?? template.background[0]}
                  />
                  <span>Color propio</span>
                </label>
                <label className={buttonClassName({ size: "sm", variant: "secondary" })}>
                  <Icon name="image" size={16} />
                  Imagen propia…
                  <input
                    accept="image/*"
                    className={styles.fileInput}
                    onChange={(event) => update("backgroundImage", event.target.files?.[0] ?? null)}
                    type="file"
                  />
                </label>
                {design.backgroundColor || design.backgroundImage ? (
                  <Button
                    onClick={() => setDesign((current) => ({ ...current, backgroundColor: null, backgroundImage: null }))}
                    size="sm"
                    variant="quiet"
                  >
                    Volver a la plantilla
                  </Button>
                ) : null}
              </div>
              {photoBackground ? (
                <Field label={`Capa de legibilidad · ${Math.round(design.scrim * 100)} %`} labelFor="postcard-scrim">
                  <input
                    className={styles.range}
                    id="postcard-scrim"
                    max={0.85}
                    min={0}
                    onChange={(event) => update("scrim", Number(event.target.value))}
                    step={0.05}
                    type="range"
                    value={design.scrim}
                  />
                </Field>
              ) : null}
              {design.backgroundImage ? (
                <Field label={`Desenfoque del fondo · ${design.blur} px`} labelFor="postcard-bg-blur">
                  <input
                    className={styles.range}
                    id="postcard-bg-blur"
                    max={24}
                    min={0}
                    onChange={(event) => update("blur", Number(event.target.value))}
                    step={1}
                    type="range"
                    value={design.blur}
                  />
                </Field>
              ) : null}
              <Control label="Textura">
                <Segmented
                  label="Textura"
                  onChange={(value) => update("texture", value)}
                  options={(["none", "paper", "grain"] as const).map((id) => ({ label: postcardTextureLabels[id], value: id }))}
                  size="sm"
                  value={design.texture}
                />
              </Control>
            </section>

            {/* ---- Referencia ---- */}
            <section aria-labelledby="postcard-reference" className={styles.group}>
              <h3 id="postcard-reference">Referencia</h3>
              <Switch
                checked={design.showAuthor}
                disabled={!content.author}
                label="Autor"
                onChange={(event) => update("showAuthor", event.target.checked)}
                {...(content.author ? {} : { description: "El documento no tiene autor en su ficha." })}
              />
              <Switch checked={design.showTitle} label="Título" onChange={(event) => update("showTitle", event.target.checked)} />
              <Switch
                checked={design.showPage}
                disabled={content.page === null}
                label="Página"
                onChange={(event) => update("showPage", event.target.checked)}
              />
              <Switch checked={design.showBrand} label="Firma «Pliegue»" onChange={(event) => update("showBrand", event.target.checked)} />
              {!design.showAuthor && !design.showTitle ? (
                <p className={styles.note}>Sin autor ni título, quien vea la postal no sabrá de dónde sale el fragmento.</p>
              ) : null}
            </section>
          </div>

          <footer className={styles.footer}>
            <div className={styles.primaryActions}>
              {shareSupported ? (
                <Button disabled={busy} onClick={() => void share()}>
                  <Icon name="share" size={18} />
                  Compartir…
                </Button>
              ) : null}
              <Button disabled={busy} onClick={() => void download()} variant={shareSupported ? "secondary" : "primary"}>
                <Icon name="download" size={18} />
                Descargar
              </Button>
              {copySupported ? (
                <Button disabled={busy} onClick={() => void copyImage()} variant="secondary">
                  <Icon name="copy" size={18} />
                  Copiar<span className={styles.wide}> imagen</span>
                </Button>
              ) : null}
            </div>
            <div className={styles.socialRow}>
              <span>Enviar el texto</span>
              <div className={styles.social}>
                {socialTargets.map((target) => (
                  <IconButton
                    icon={target.icon}
                    key={target.id}
                    label={`Enviar por ${target.label}`}
                    onClick={() => openSocialTarget(target.url(shareText, `${content.title} · Pliegue`))}
                    size="sm"
                  />
                ))}
                <IconButton icon="copy" label="Copiar el texto" onClick={() => void copyText()} size="sm" />
              </div>
            </div>
            <p aria-live="polite" className={styles.status} data-default={message ? undefined : "true"} role="status">
              {message ??
                (shareSupported
                  ? "«Compartir…» abre el menú del sistema con la imagen: Instagram, WhatsApp, Telegram…"
                  : "Para Instagram o Facebook, descarga la imagen o cópiala y pégala allí.")}
            </p>
          </footer>
        </div>
      </div>
    </dialog>
  );
}

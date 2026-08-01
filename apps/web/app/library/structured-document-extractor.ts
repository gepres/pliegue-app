import type { DocumentFormat } from "./documents";

export const maxArchiveInputBytes = 50 * 1024 * 1024;
export const maxArchiveEntryBytes = 5 * 1024 * 1024;
export const maxArchiveOutputBytes = 16 * 1024 * 1024;
export const maxStructuredTextCharacters = 1_000_000;

const maxArchiveEntries = 5_000;
const maxSelectedEntries = 800;
const maxSpreadsheetColumns = 64;
const maxSpreadsheetRows = 1_000;

export type StructuredDocumentFormat = Extract<
  DocumentFormat,
  "docx" | "epub" | "pptx" | "xlsx"
>;

export type StructuredDocumentBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "table"; rows: string[][] };

export interface StructuredDocumentSection {
  blocks: StructuredDocumentBlock[];
  id: string;
  label: string;
  title: string;
}

export interface StructuredDocumentExtraction {
  sections: StructuredDocumentSection[];
  truncated: boolean;
}

interface ArchiveEntries {
  entries: Map<string, string>;
  limited: boolean;
}

const xmlEntityPattern = /&(#x[\da-f]+|#\d+|amp|apos|gt|lt|nbsp|quot);/gi;

function decodeXmlEntities(value: string) {
  return value.replace(xmlEntityPattern, (entity, token: string) => {
    const normalized = token.toLocaleLowerCase("en");
    if (normalized === "amp") return "&";
    if (normalized === "apos") return "'";
    if (normalized === "gt") return ">";
    if (normalized === "lt") return "<";
    if (normalized === "nbsp") return " ";
    if (normalized === "quot") return '"';

    const codePoint = normalized.startsWith("#x")
      ? Number.parseInt(normalized.slice(2), 16)
      : Number.parseInt(normalized.slice(1), 10);

    try {
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
    } catch {
      return entity;
    }
  });
}

function normalizeText(value: string) {
  return decodeXmlEntities(
    value
      .replaceAll(/<br\s*\/?\s*>/gi, "\n")
      .replaceAll(/<[^>]+>/g, ""),
  )
    .replaceAll(/\r/g, "")
    .replaceAll(/[\t\f\v ]+/g, " ")
    .replaceAll(/ *\n */g, "\n")
    .trim();
}

function attributeValue(tag: string, name: string) {
  const escapedName = name.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = tag.match(new RegExp(`(?:^|\\s)${escapedName}\\s*=\\s*(["'])(.*?)\\1`, "i"));
  return match?.[2] ? decodeXmlEntities(match[2]) : null;
}

function extractTextElements(fragment: string) {
  const parts: string[] = [];
  const tokenPattern =
    /<(?:[\w-]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?t\s*>|<(?:[\w-]+:)?(?:br|tab)\b[^>]*\/?\s*>/gi;

  for (const match of fragment.matchAll(tokenPattern)) {
    if (match[1] !== undefined) parts.push(normalizeText(match[1]));
    else if (/tab/i.test(match[0])) parts.push("\t");
    else parts.push("\n");
  }

  return parts.join("").replaceAll(/\t+/g, "\t").trim();
}

function normalizeArchiveName(name: string) {
  const parts = name.replaceAll("\\", "/").replace(/^\/+/, "").split("/");
  if (parts.some((part) => part === "..")) return null;
  return parts.filter((part) => part && part !== ".").join("/");
}

function archiveEntryIsWanted(format: StructuredDocumentFormat, name: string) {
  if (format === "docx") return /^word\/document\.xml$/i.test(name);
  if (format === "pptx") return /^ppt\/slides\/slide\d+\.xml$/i.test(name);
  if (format === "xlsx") {
    return /^(xl\/(sharedStrings|workbook)\.xml|xl\/_rels\/workbook\.xml\.rels|xl\/worksheets\/sheet\d+\.xml)$/i.test(
      name,
    );
  }

  return (
    /^META-INF\/container\.xml$/i.test(name) ||
    /\.(?:opf|xhtml|html|htm)$/i.test(name)
  );
}

async function readArchive(
  format: StructuredDocumentFormat,
  blob: Blob,
): Promise<ArchiveEntries> {
  if (blob.size > maxArchiveInputBytes) {
    throw new Error("El archivo supera el límite de 50 MB para extracción local.");
  }

  const [{ unzip }, buffer] = await Promise.all([
    import("fflate"),
    blob.arrayBuffer(),
  ]);
  let archiveEntries = 0;
  let selectedEntries = 0;
  let projectedBytes = 0;
  let limited = false;

  let files: Record<string, Uint8Array>;

  try {
    files = await new Promise((resolve, reject) => {
      unzip(
        new Uint8Array(buffer),
        {
          filter(file) {
            archiveEntries += 1;
            const name = normalizeArchiveName(file.name);
            if (archiveEntries > maxArchiveEntries) {
              limited = true;
              return false;
            }
            if (!name || !archiveEntryIsWanted(format, name)) return false;

            selectedEntries += 1;
            const outputSize = file.originalSize;
            const compressionRatio = file.size > 0 ? outputSize / file.size : outputSize;
            const exceedsLimit =
              selectedEntries > maxSelectedEntries ||
              !Number.isFinite(outputSize) ||
              outputSize < 0 ||
              outputSize > maxArchiveEntryBytes ||
              projectedBytes + outputSize > maxArchiveOutputBytes ||
              compressionRatio > 250;

            if (exceedsLimit) {
              limited = true;
              return false;
            }

            projectedBytes += outputSize;
            return true;
          },
        },
        (error, unzipped) => {
          if (error) reject(error);
          else resolve(unzipped);
        },
      );
    });
  } catch {
    throw new Error("El archivo está dañado, protegido o no contiene un ZIP válido.");
  }

  const decoder = new TextDecoder("utf-8", { fatal: false });
  const entries = new Map<string, string>();

  for (const [rawName, data] of Object.entries(files)) {
    const name = normalizeArchiveName(rawName);
    if (name) entries.set(name, decoder.decode(data).replace(/^\uFEFF/, ""));
  }

  return { entries, limited };
}

function findEntry(entries: Map<string, string>, path: string) {
  const normalizedPath = normalizeArchiveName(path);
  if (!normalizedPath) return null;
  const exact = entries.get(normalizedPath);
  if (exact !== undefined) return exact;

  const lowerPath = normalizedPath.toLocaleLowerCase("en");
  for (const [name, value] of entries) {
    if (name.toLocaleLowerCase("en") === lowerPath) return value;
  }

  return null;
}

function resolveArchivePath(basePath: string, relativePath: string) {
  let decodedPath = relativePath.split("#", 1)[0] ?? "";
  try {
    decodedPath = decodeURIComponent(decodedPath);
  } catch {
    // Keep the original path when it contains malformed percent escapes.
  }

  if (decodedPath.startsWith("/")) return normalizeArchiveName(decodedPath) ?? "";

  const parts = [...basePath.split("/").slice(0, -1), ...decodedPath.split("/")];
  const resolved: string[] = [];

  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") resolved.pop();
    else resolved.push(part);
  }

  return resolved.join("/");
}

function extractDocx(entries: Map<string, string>): StructuredDocumentSection[] {
  const xml = findEntry(entries, "word/document.xml");
  if (!xml) return [];

  const blocks: StructuredDocumentBlock[] = [];

  for (const match of xml.matchAll(/<w:p\b[\s\S]*?<\/w:p\s*>/gi)) {
    const paragraph = match[0];
    const text = extractTextElements(paragraph);
    if (!text) continue;

    const styleTag = paragraph.match(/<w:pStyle\b[^>]*>/i)?.[0] ?? "";
    const style = attributeValue(styleTag, "w:val") ?? "";
    const headingMatch = style.match(/(?:heading|title|titulo|título)\s*([1-6])/i);

    if (headingMatch) {
      blocks.push({
        kind: "heading",
        level: Number.parseInt(headingMatch[1] ?? "2", 10),
        text,
      });
    } else {
      blocks.push({
        kind: "paragraph",
        text: /<w:numPr\b/i.test(paragraph) ? `• ${text}` : text,
      });
    }
  }

  return blocks.length
    ? [{ blocks, id: "docx-body", label: "Documento Word", title: "Contenido extraído" }]
    : [];
}

function numericArchiveOrder(name: string) {
  return Number.parseInt(name.match(/(\d+)(?=\.xml$)/i)?.[1] ?? "0", 10);
}

function extractPptx(entries: Map<string, string>): StructuredDocumentSection[] {
  const slideEntries = [...entries.entries()]
    .filter(([name]) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .toSorted(([left], [right]) => numericArchiveOrder(left) - numericArchiveOrder(right));

  return slideEntries.flatMap(([name, xml]) => {
    const slideNumber = numericArchiveOrder(name);
    const paragraphs: string[] = [];

    for (const match of xml.matchAll(/<a:p\b[\s\S]*?<\/a:p\s*>/gi)) {
      const text = extractTextElements(match[0]);
      if (text) paragraphs.push(text);
    }

    if (!paragraphs.length) return [];

    const blocks: StructuredDocumentBlock[] = paragraphs.map((text, index) =>
      index === 0
        ? { kind: "heading", level: 2, text }
        : { kind: "paragraph", text },
    );

    return [
      {
        blocks,
        id: `slide-${slideNumber}`,
        label: `Diapositiva ${slideNumber}`,
        title: `Contenido de la diapositiva ${slideNumber}`,
      },
    ];
  });
}

function columnIndexFromReference(reference: string) {
  const letters = reference.match(/^[A-Z]+/i)?.[0]?.toLocaleUpperCase("en") ?? "";
  let index = 0;
  for (const letter of letters) index = index * 26 + letter.charCodeAt(0) - 64;
  return index - 1;
}

function extractSharedStrings(xml: string | null) {
  if (!xml) return [];
  return [...xml.matchAll(/<(?:\w+:)?si\b[\s\S]*?<\/(?:\w+:)?si\s*>/gi)].map(
    (match) => extractTextElements(match[0]),
  );
}

function extractWorksheetRows(xml: string, sharedStrings: readonly string[]) {
  const rows: string[][] = [];
  let truncated = false;

  for (const rowMatch of xml.matchAll(/<(?:\w+:)?row\b[\s\S]*?<\/(?:\w+:)?row\s*>/gi)) {
    if (rows.length >= maxSpreadsheetRows) {
      truncated = true;
      break;
    }

    const row: string[] = [];

    for (const cellMatch of rowMatch[0].matchAll(
      /<((?:\w+:)?c)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi,
    )) {
      const openTag = `<c ${cellMatch[2] ?? ""}>`;
      const reference = attributeValue(openTag, "r") ?? "";
      const columnIndex = columnIndexFromReference(reference);
      if (columnIndex < 0 || columnIndex >= maxSpreadsheetColumns) {
        truncated = true;
        continue;
      }

      const type = attributeValue(openTag, "t") ?? "";
      const content = cellMatch[3] ?? "";
      const rawValue = normalizeText(
        content.match(/<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v\s*>/i)?.[1] ?? "",
      );
      const value =
        type === "s"
          ? (sharedStrings[Number.parseInt(rawValue, 10)] ?? rawValue)
          : type === "inlineStr"
            ? extractTextElements(content)
            : type === "b"
              ? rawValue === "1"
                ? "VERDADERO"
                : "FALSO"
              : rawValue;

      while (row.length < columnIndex) row.push("");
      row[columnIndex] = value;
    }

    if (row.some(Boolean)) rows.push(row);
  }

  return { rows, truncated };
}

function extractXlsx(entries: Map<string, string>) {
  const sharedStrings = extractSharedStrings(findEntry(entries, "xl/sharedStrings.xml"));
  const workbook = findEntry(entries, "xl/workbook.xml");
  const relationships = findEntry(entries, "xl/_rels/workbook.xml.rels");
  const namesByPath = new Map<string, string>();

  if (workbook && relationships) {
    const pathsByRelation = new Map<string, string>();
    for (const match of relationships.matchAll(/<(?:\w+:)?Relationship\b[^>]*\/?\s*>/gi)) {
      const id = attributeValue(match[0], "Id");
      const target = attributeValue(match[0], "Target");
      if (id && target) pathsByRelation.set(id, resolveArchivePath("xl/workbook.xml", target));
    }

    for (const match of workbook.matchAll(/<(?:\w+:)?sheet\b[^>]*\/?\s*>/gi)) {
      const name = attributeValue(match[0], "name");
      const relationId = attributeValue(match[0], "r:id");
      const path = relationId ? pathsByRelation.get(relationId) : null;
      if (name && path) namesByPath.set(path.toLocaleLowerCase("en"), name);
    }
  }

  let truncated = false;
  const worksheetEntries = [...entries.entries()]
    .filter(([name]) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .toSorted(([left], [right]) => numericArchiveOrder(left) - numericArchiveOrder(right));
  const sections = worksheetEntries.flatMap(([name, xml], index) => {
    const worksheet = extractWorksheetRows(xml, sharedStrings);
    if (worksheet.truncated) truncated = true;
    if (!worksheet.rows.length) return [];

    const sheetNumber = numericArchiveOrder(name) || index + 1;
    return [
      {
        blocks: [{ kind: "table", rows: worksheet.rows } as const],
        id: `sheet-${sheetNumber}`,
        label: `Hoja ${sheetNumber}`,
        title: namesByPath.get(name.toLocaleLowerCase("en")) ?? `Hoja ${sheetNumber}`,
      },
    ];
  });

  return { sections, truncated };
}

function extractHtmlBlocks(html: string) {
  const sanitized = html
    .replaceAll(/<!--([\s\S]*?)-->/g, "")
    .replaceAll(/<(script|style|svg|nav)\b[\s\S]*?<\/\1\s*>/gi, "");
  const blocks: StructuredDocumentBlock[] = [];
  let previousText = "";

  for (const match of sanitized.matchAll(
    /<(h[1-6]|p|li|blockquote|figcaption|pre)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi,
  )) {
    const tag = (match[1] ?? "p").toLocaleLowerCase("en");
    const text = normalizeText(match[2] ?? "");
    if (!text || text === previousText) continue;
    previousText = text;

    if (tag.startsWith("h")) {
      blocks.push({ kind: "heading", level: Number.parseInt(tag.slice(1), 10), text });
    } else {
      blocks.push({ kind: "paragraph", text: tag === "li" ? `• ${text}` : text });
    }
  }

  if (!blocks.length) {
    const body = normalizeText(sanitized.match(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/i)?.[1] ?? "");
    if (body) blocks.push({ kind: "paragraph", text: body });
  }

  return blocks;
}

function extractEpub(entries: Map<string, string>): StructuredDocumentSection[] {
  const container = findEntry(entries, "META-INF/container.xml");
  const rootfileTag = container?.match(/<(?:\w+:)?rootfile\b[^>]*>/i)?.[0] ?? "";
  const declaredPackagePath = attributeValue(rootfileTag, "full-path");
  const packagePath =
    declaredPackagePath ?? [...entries.keys()].find((name) => /\.opf$/i.test(name)) ?? null;
  if (!packagePath) return [];

  const packageXml = findEntry(entries, packagePath);
  if (!packageXml) return [];

  const manifest = new Map<string, { href: string; mediaType: string }>();
  for (const match of packageXml.matchAll(/<(?:\w+:)?item\b[^>]*\/?\s*>/gi)) {
    const id = attributeValue(match[0], "id");
    const href = attributeValue(match[0], "href");
    if (!id || !href) continue;
    manifest.set(id, {
      href,
      mediaType: attributeValue(match[0], "media-type") ?? "",
    });
  }

  const orderedPaths: string[] = [];
  for (const match of packageXml.matchAll(/<(?:\w+:)?itemref\b[^>]*\/?\s*>/gi)) {
    const idref = attributeValue(match[0], "idref");
    const item = idref ? manifest.get(idref) : null;
    if (!item || !/(?:xhtml|html)/i.test(item.mediaType + item.href)) continue;
    orderedPaths.push(resolveArchivePath(packagePath, item.href));
  }

  if (!orderedPaths.length) {
    for (const item of manifest.values()) {
      if (/(?:xhtml|html)/i.test(item.mediaType + item.href)) {
        orderedPaths.push(resolveArchivePath(packagePath, item.href));
      }
    }
  }

  return orderedPaths.flatMap((path, index) => {
    const html = findEntry(entries, path);
    if (!html) return [];
    const blocks = extractHtmlBlocks(html);
    if (!blocks.length) return [];
    const firstHeading = blocks.find(
      (block): block is Extract<StructuredDocumentBlock, { kind: "heading" }> =>
        block.kind === "heading",
    );

    return [
      {
        blocks,
        id: `chapter-${index + 1}`,
        label: `Sección ${index + 1}`,
        title: firstHeading?.text ?? path.split("/").at(-1)?.replace(/\.[^.]+$/, "") ?? "Sección",
      },
    ];
  });
}

function limitExtraction(
  sections: readonly StructuredDocumentSection[],
  initiallyTruncated: boolean,
): StructuredDocumentExtraction {
  let remaining = maxStructuredTextCharacters;
  let truncated = initiallyTruncated || sections.length > 300;
  const limitedSections: StructuredDocumentSection[] = [];

  for (const section of sections.slice(0, 300)) {
    const blocks: StructuredDocumentBlock[] = [];

    for (const block of section.blocks) {
      if (remaining <= 0) {
        truncated = true;
        break;
      }

      if (block.kind === "table") {
        const rows: string[][] = [];
        for (const row of block.rows) {
          const limitedRow: string[] = [];
          for (const cell of row) {
            const value = cell.slice(0, Math.min(5_000, remaining));
            if (value.length < cell.length) truncated = true;
            remaining -= value.length;
            limitedRow.push(value);
            if (remaining <= 0) break;
          }
          if (limitedRow.some(Boolean)) rows.push(limitedRow);
          if (remaining <= 0) break;
        }
        if (rows.length) blocks.push({ kind: "table", rows });
        continue;
      }

      const text = block.text.slice(0, remaining);
      if (text.length < block.text.length) truncated = true;
      remaining -= text.length;
      if (text) blocks.push({ ...block, text });
    }

    if (blocks.length) limitedSections.push({ ...section, blocks });
    if (remaining <= 0) break;
  }

  return { sections: limitedSections, truncated };
}

export async function extractStructuredDocument(
  format: StructuredDocumentFormat,
  blob: Blob,
): Promise<StructuredDocumentExtraction> {
  const archive = await readArchive(format, blob);
  let sections: StructuredDocumentSection[] = [];
  let parserTruncated = false;

  if (format === "docx") sections = extractDocx(archive.entries);
  if (format === "pptx") sections = extractPptx(archive.entries);
  if (format === "epub") sections = extractEpub(archive.entries);
  if (format === "xlsx") {
    const workbook = extractXlsx(archive.entries);
    sections = workbook.sections;
    parserTruncated = workbook.truncated;
  }

  const result = limitExtraction(sections, archive.limited || parserTruncated);
  if (!result.sections.length) {
    throw new Error(
      archive.limited
        ? "El contenido excede los límites seguros de extracción local."
        : "No encontramos texto legible en la estructura del documento.",
    );
  }

  return result;
}

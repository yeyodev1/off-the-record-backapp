import crypto from "crypto";

type AnyRecord = Record<string, unknown>;

export function stripHtml(html: string, options: { collapseSpaces?: boolean } = {}) {
  const collapse = options.collapseSpaces !== false;

  const text = String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

  return (collapse ? text.replace(/[ \t]+/g, " ") : text).replace(/\n{3,}/g, "\n\n").trim();
}

export function slugify(value: string) {
  return String(value || "")
    .normalize("NFD")
    .split("")
    .filter((ch) => ch.charCodeAt(0) < 0x300 || ch.charCodeAt(0) > 0x36f)
    .join("")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

/** Cada vocal acepta sus variantes acentuadas. */
const ACCENT_CLASSES: Record<string, string> = {
  a: "[aáàäâã]",
  e: "[eéèëê]",
  i: "[iíìïî]",
  o: "[oóòöôõ]",
  u: "[uúùüû]",
  n: "[nñ]",
  c: "[cç]",
};

/**
 * Mongo no aplica *collation* a `$regex`, así que la única forma de que
 * "corrupcion" encuentre "Corrupción" es ampliar cada vocal en el patrón.
 * De paso se escapan los caracteres especiales: la búsqueda es texto libre
 * del usuario y no debe poder inyectar una expresión regular.
 */
export function accentInsensitivePattern(input: string) {
  return String(input || "")
    .normalize("NFD")
    .split("")
    .filter((ch) => ch.charCodeAt(0) < 0x300 || ch.charCodeAt(0) > 0x36f)
    .join("")
    .toLowerCase()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .split("")
    .map((ch) => ACCENT_CLASSES[ch] || ch)
    .join("");
}

export function randomToken(size = 24) {
  return crypto.randomBytes(size).toString("base64url");
}

export function blocksToText(blocks: AnyRecord[] | undefined) {
  if (!Array.isArray(blocks)) return "";

  return blocks
    .map((block) => {
      const items = Array.isArray(block.items) ? (block.items as string[]).join("\n") : "";
      const html = typeof block.html === "string" ? stripHtml(block.html) : "";
      const text = typeof block.text === "string" ? block.text : "";
      const caption = typeof block.caption === "string" ? block.caption : "";
      return [text || html, items, caption].filter(Boolean).join("\n");
    })
    .filter(Boolean)
    .join("\n\n");
}

export function blocksToHtml(blocks: AnyRecord[] | undefined) {
  if (!Array.isArray(blocks)) return "";

  return blocks
    .map((block) => {
      const kind = String(block.kind || "paragraph");
      const color = typeof block.color === "string" && block.color ? block.color : "";
      const align = String(block.align || "left");
      const indent = Number(block.indent || 0);
      const lineHeight = Number(block.lineHeight || 1.7);
      const fontFamily = String(block.fontFamily || "");
      const fontSize = String(block.fontSize || "");

      const style = [
        `text-align:${align}`,
        indent ? `padding-inline-start:${indent * 24}px` : "",
        `line-height:${lineHeight}`,
        fontFamily ? `font-family:${fontFamily}` : "",
        fontSize ? `font-size:${fontSize}` : "",
        color && kind !== "divider" ? `color:${color}` : "",
      ]
        .filter(Boolean)
        .join(";");

      const inner = typeof block.html === "string" && block.html ? block.html : escapeHtml(String(block.text || ""));

      switch (kind) {
        case "heading":
          return `<h2 style="${style}">${inner}</h2>`;
        case "subheading":
        case "intertitle":
          return `<h3 class="otr-intertitle" style="${style};--otr-accent:${color || "currentColor"}">${inner}</h3>`;
        case "quote":
          return `<blockquote style="${style};border-inline-start:3px solid ${color || "currentColor"}">${inner}</blockquote>`;
        case "divider":
          return `<hr class="otr-divider" style="border-color:${color || "currentColor"}" />`;
        case "callout":
          return `<aside class="otr-callout" style="${style};background:${block.background || "transparent"};border-inline-start:4px solid ${color || "currentColor"}">${inner}</aside>`;
        case "list": {
          const items = Array.isArray(block.items) ? (block.items as string[]) : [];
          const tag = block.ordered ? "ol" : "ul";
          return `<${tag} style="${style}">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</${tag}>`;
        }
        case "media": {
          const url = String(block.assetUrl || "");
          const assetKind = String(block.assetKind || "image");
          const caption = block.caption ? `<figcaption>${escapeHtml(String(block.caption))}</figcaption>` : "";
          if (!url) return "";
          if (assetKind === "video") return `<figure class="otr-media"><video controls src="${url}"></video>${caption}</figure>`;
          if (assetKind === "audio") return `<figure class="otr-media"><audio controls src="${url}"></audio>${caption}</figure>`;
          if (assetKind === "document")
            return `<figure class="otr-media"><a href="${url}" target="_blank" rel="noreferrer">${escapeHtml(String(block.caption || "Documento"))}</a></figure>`;
          return `<figure class="otr-media"><img src="${url}" alt="${escapeHtml(String(block.caption || ""))}" />${caption}</figure>`;
        }
        case "chart":
        case "infographic":
          return `<figure class="otr-figure" data-kind="${kind}" data-payload='${escapeAttr(JSON.stringify(block.meta || {}))}'>${
            block.caption ? `<figcaption>${escapeHtml(String(block.caption))}</figcaption>` : ""
          }</figure>`;
        default:
          // El editor ya entrega HTML de bloque; envolverlo en <p> produciría
          // marcado inválido, así que en ese caso usamos un contenedor neutro.
          return /^\s*<(p|div|h[1-6]|ul|ol|blockquote|figure|pre)\b/i.test(inner)
            ? `<div style="${style}">${inner}</div>`
            : `<p style="${style}">${inner}</p>`;
      }
    })
    .filter(Boolean)
    .join("\n");
}

export function escapeHtml(value: string) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value: string) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

export function countWords(text: string) {
  const clean = String(text || "").trim();
  if (!clean) return 0;
  return clean.split(/\s+/).length;
}

export function readingMinutes(words: number) {
  return Math.max(1, Math.round(words / 200));
}

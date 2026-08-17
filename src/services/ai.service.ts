import Anthropic from "@anthropic-ai/sdk";
import { cloudinary, isCloudinaryConfigured } from "../config/cloudinary";
import { stripHtml } from "./content.service";
import {
  GeminiImageInput,
  downloadGeminiVideo,
  geminiImage,
  geminiJson,
  geminiSpeech,
  geminiText,
  isGeminiConfigured,
  pollGeminiVideo,
  startGeminiVideo,
} from "./gemini.service";

/**
 * Capa de IA de la redacción.
 *
 * Gemini es el proveedor principal: una sola GOOGLE_API_KEY cubre texto,
 * imagen, audio y video. Anthropic y OpenAI quedan como alternativas
 * opcionales para quien prefiera esos modelos.
 */

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5";

let anthropicClient: Anthropic | null = null;

function getAnthropic() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  anthropicClient ||= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return anthropicClient;
}

/** Gemini manda salvo que se pida explícitamente Anthropic. */
function textProvider(): "gemini" | "anthropic" | null {
  const preferred = (process.env.AI_TEXT_PROVIDER || "").toLowerCase();

  if (preferred === "anthropic" && getAnthropic()) return "anthropic";
  if (preferred === "gemini" && isGeminiConfigured()) return "gemini";

  if (isGeminiConfigured()) return "gemini";
  if (getAnthropic()) return "anthropic";
  return null;
}

export function aiCapabilities() {
  const gemini = isGeminiConfigured();

  return {
    provider: textProvider() || "none",
    text: Boolean(textProvider()),
    image: gemini || Boolean(process.env.OPENAI_API_KEY),
    audio: gemini || Boolean(process.env.OPENAI_API_KEY),
    video: gemini || Boolean(process.env.AI_VIDEO_WEBHOOK),
    infographic: Boolean(textProvider()),
    infographicImage: gemini && isCloudinaryConfigured(),
    photos: isCloudinaryConfigured(),
    reports: Boolean(textProvider()),
    storage: isCloudinaryConfigured(),
  };
}

export class AiUnavailableError extends Error {
  constructor(capability: string) {
    super(`La capacidad de IA "${capability}" no está configurada en el servidor`);
    this.name = "AiUnavailableError";
  }
}

/* ------------------------------------------------------------------ */
/* Texto — enrutado por proveedor                                      */
/* ------------------------------------------------------------------ */

function anthropicText(message: Anthropic.Message) {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

async function completeText(system: string, prompt: string, maxTokens = 4000) {
  const provider = textProvider();
  if (!provider) throw new AiUnavailableError("texto");

  if (provider === "gemini") return geminiText(system, prompt, maxTokens);

  const client = getAnthropic()!;
  const message = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: prompt }],
  });

  if (message.stop_reason === "refusal") throw new Error("El modelo rechazó la solicitud");
  return anthropicText(message);
}

export async function completeJson<T>(
  system: string,
  prompt: string,
  schema: Record<string, unknown>,
  maxTokens = 6000,
): Promise<T> {
  const provider = textProvider();
  if (!provider) throw new AiUnavailableError("texto");

  if (provider === "gemini") return geminiJson<T>(system, prompt, schema, maxTokens);

  const client = getAnthropic()!;
  const message = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: maxTokens,
    system,
    output_config: { format: { type: "json_schema", schema } },
    messages: [{ role: "user", content: prompt }],
  });

  if (message.stop_reason === "refusal") throw new Error("El modelo rechazó la solicitud");

  const raw = anthropicText(message);
  try {
    return JSON.parse(raw) as T;
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1)) as T;
    throw new Error("La respuesta del modelo no es JSON válido");
  }
}

export const NEWSROOM_SYSTEM = [
  "Eres el asistente editorial de Off The Record, un medio de periodismo de investigación en español.",
  "Escribes en español neutro, con precisión factual y sin inventar datos que no estén en el material entregado.",
  "Nunca agregas afirmaciones nuevas: solo reorganizas, resumes o etiquetas la información que recibes.",
].join(" ");

/* ------------------------------------------------------------------ */
/* Texto editorial                                                     */
/* ------------------------------------------------------------------ */

export async function generateSummary(body: string) {
  const clean = stripHtml(body).slice(0, 40000);
  return completeText(
    NEWSROOM_SYSTEM,
    `Redacta un sumario editorial de 2 a 3 frases para este reportaje. Devuelve únicamente el sumario, sin comillas ni encabezado.\n\n${clean}`,
    600,
  );
}

const INTERTITLES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    intertitles: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          text: { type: "string" },
          afterParagraph: { type: "integer" },
          color: { type: "string" },
        },
        required: ["text", "afterParagraph", "color"],
      },
    },
  },
  required: ["intertitles"],
};

export interface GeneratedIntertitle {
  text: string;
  afterParagraph: number;
  color: string;
}

export async function generateIntertitles(body: string) {
  const paragraphs = stripHtml(body)
    .split(/\n{2,}/)
    .filter(Boolean);

  const numbered = paragraphs.map((paragraph, index) => `[${index}] ${paragraph}`).join("\n\n").slice(0, 40000);

  const result = await completeJson<{ intertitles: GeneratedIntertitle[] }>(
    NEWSROOM_SYSTEM,
    [
      "Divide este reportaje en secciones temáticas.",
      "Para cada corte propone un intertítulo corto (máximo 6 palabras) y un color hexadecimal que represente el tono de la sección.",
      "`afterParagraph` es el índice del párrafo tras el cual va el intertítulo.",
      "Devuelve entre 2 y 8 intertítulos.",
      "",
      numbered,
    ].join("\n"),
    INTERTITLES_SCHEMA,
  );

  return result.intertitles || [];
}

const HEADLINES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headlines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          angle: { type: "string" },
          weight: { type: "number" },
        },
        required: ["title", "angle", "weight"],
      },
    },
  },
  required: ["headlines"],
};

export async function generateHeadlines(body: string) {
  const result = await completeJson<{ headlines: { title: string; angle: string; weight: number }[] }>(
    NEWSROOM_SYSTEM,
    [
      "Propone 5 titulares alternativos para este reportaje.",
      "`angle` describe el enfoque en 4 palabras. `weight` es un puntaje de 0 a 100 de fuerza informativa.",
      "",
      stripHtml(body).slice(0, 30000),
    ].join("\n"),
    HEADLINES_SCHEMA,
  );

  return result.headlines || [];
}

/* ------------------------------------------------------------------ */
/* Infografías interactivas                                            */
/* ------------------------------------------------------------------ */

export const INFOGRAPHIC_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    subtitle: { type: "string" },
    kind: { type: "string", enum: ["bar", "line", "donut", "timeline", "comparison", "stat"] },
    unit: { type: "string" },
    source: { type: "string" },
    series: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          label: { type: "string" },
          value: { type: "number" },
          color: { type: "string" },
          note: { type: "string" },
        },
        required: ["label", "value", "color", "note"],
      },
    },
    insights: { type: "array", items: { type: "string" } },
  },
  required: ["title", "subtitle", "kind", "unit", "source", "series", "insights"],
};

export interface InfographicSpec {
  title: string;
  subtitle: string;
  kind: "bar" | "line" | "donut" | "timeline" | "comparison" | "stat";
  unit: string;
  source: string;
  series: { label: string; value: number; color: string; note: string }[];
  insights: string[];
}

export async function generateInfographic(body: string, hint = "") {
  return completeJson<InfographicSpec>(
    NEWSROOM_SYSTEM,
    [
      "Extrae los datos cuantificables de este material y arma la especificación de una infografía interactiva.",
      "Usa exclusivamente cifras presentes en el texto. Si no hay cifras suficientes, usa kind='stat' con los indicadores disponibles.",
      "Los colores deben ser hexadecimales con buen contraste sobre fondo oscuro.",
      hint ? `Enfoque solicitado: ${hint}` : "",
      "",
      stripHtml(body).slice(0, 40000),
    ]
      .filter(Boolean)
      .join("\n"),
    INFOGRAPHIC_SCHEMA,
  );
}

/* ------------------------------------------------------------------ */
/* Infografías de imagen (pósters)                                     */
/* ------------------------------------------------------------------ */

const POSTER_BRIEF_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headline: { type: "string", description: "Titular corto y contundente, máximo 8 palabras" },
    subtitle: { type: "string", description: "Bajada de una frase que contextualiza" },
    subject: {
      type: "string",
      description: "Nombre propio de la persona protagonista del texto (ej. 'Rafael Correa'), o cadena vacía si no hay una persona central",
    },
    stats: {
      type: "array",
      description: "Entre 3 y 5 cifras clave, las más importantes del texto",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          figure: { type: "string", description: "La cifra exacta tal como aparece, ej. '19,5%'" },
          label: { type: "string", description: "Qué mide, máximo 6 palabras" },
        },
        required: ["figure", "label"],
      },
    },
    comparison: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string", description: "Título de la comparativa, máximo 5 palabras" },
        items: {
          type: "array",
          description: "Entre 2 y 6 elementos comparados",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              label: { type: "string" },
              figure: { type: "string" },
            },
            required: ["label", "figure"],
          },
        },
      },
      required: ["title", "items"],
    },
    source: { type: "string", description: "Fuente de los datos, ej. 'INEC y Mentinno'" },
    altText: { type: "string", description: "Descripción accesible en español de la infografía" },
  },
  required: ["headline", "subtitle", "subject", "stats", "comparison", "source", "altText"],
};

export interface PosterBrief {
  headline: string;
  subtitle: string;
  subject: string;
  stats: { figure: string; label: string }[];
  comparison: { title: string; items: { label: string; figure: string }[] };
  source: string;
  altText: string;
}

const POSTER_STYLES = [
  {
    key: "editorial",
    label: "Editorial tipográfica",
    direction:
      "flat vector editorial data poster, Swiss grid layout, bold typographic hierarchy with one oversized hero figure, clean chart blocks",
  },
  {
    key: "isometric",
    label: "Isométrica 3D",
    direction:
      "isometric 3D data visualization scene, charts and figures rendered as clean physical objects on floating platforms, soft studio lighting",
  },
  {
    key: "dashboard",
    label: "Tarjetas de datos",
    direction:
      "elegant minimal dashboard-style layout of data cards, thin luminous lines, subtle glassmorphism panels, precise micro-typography",
  },
];

function posterPrompt(brief: PosterBrief, direction: string, photoCredit = "") {
  const stats = brief.stats.map((s) => `"${s.figure}" con la etiqueta "${s.label}"`).join("; ");
  const comparison = brief.comparison.items.map((i) => `${i.label}: ${i.figure}`).join(" · ");
  const withPhoto = Boolean(photoCredit);

  const footer = withPhoto ? `Fuente: ${brief.source} · ${photoCredit}` : `Fuente: ${brief.source}`;

  return [
    'Design a premium single-image editorial infographic poster for the Spanish-language investigative news outlet "OFF THE RECORD".',
    `Visual style: ${direction}.`,
    "Color palette: deep navy background, brand red, accent blue, gold and cream for text (the outlet's dark editorial look).",
    "Vertical poster, everything must fit inside one image with a clear reading order, generous margins and nothing cut off at the edges.",
    withPhoto
      ? `The attached photograph shows ${brief.subject}, the story's protagonist. Make this person the poster's hero visual: a clean editorial cutout or duotone treatment integrated with the palette, occupying a prominent area. Preserve the person's face and likeness exactly as in the photograph — do not alter, beautify or replace their features — and do not add any other people.`
      : "No photographs of real identifiable people.",
    "No watermarks, crisp legible typography at small sizes.",
    "",
    "TEXT RULES — follow them strictly:",
    "- The only text allowed in the image is the quoted Spanish text from the list below, plus the masthead OFF THE RECORD.",
    "- Copy each quoted string EXACTLY, character by character, with perfect Spanish spelling. The quotes, the numbering and everything written in English are instructions and must NEVER appear in the image.",
    "- Render each stat exactly once. Do not duplicate, alter or invent numbers, cards or filler text. If space remains, leave clean breathing room or purely decorative graphics without text.",
    "",
    "The poster contains, in this order:",
    "1. Masthead: OFF THE RECORD",
    `2. Main headline: "${brief.headline}"`,
    `3. Subheadline: "${brief.subtitle}"`,
    `4. Highlighted key stats, each one big figure with its small label underneath: ${stats}`,
    `5. A compact ranked chart titled "${brief.comparison.title}" with: ${comparison}`,
    `6. Small footer: "${footer}"`,
  ].join("\n");
}

export interface InfographicPoster {
  url: string;
  publicId: string;
  bytes: number;
  style: string;
  styleLabel: string;
}

export interface InfographicPosterSet {
  brief: PosterBrief;
  posters: InfographicPoster[];
  /** Crédito de la foto integrada, si el póster lleva a la persona protagonista. */
  photoCredit?: string;
  photoSource?: string;
}

/**
 * Genera tres pósters candidatos (una sola imagen cada uno) a partir del
 * reportaje. El editor escoge uno; los descartados se borran con
 * `discardAiAssets`.
 */
export async function generateInfographicPosters(body: string, hint = ""): Promise<InfographicPosterSet> {
  if (!isGeminiConfigured()) throw new AiUnavailableError("infografía de imagen");
  if (!isCloudinaryConfigured()) throw new AiUnavailableError("almacenamiento");

  const brief = await completeJson<PosterBrief>(
    NEWSROOM_SYSTEM,
    [
      "Extrae el contenido para una infografía de una sola imagen a partir de este reportaje.",
      "Usa exclusivamente cifras y afirmaciones presentes en el texto, copiadas con exactitud.",
      "El conjunto debe caber en un póster: sé selectivo, no exhaustivo.",
      hint ? `Enfoque solicitado: ${hint}` : "",
      "",
      stripHtml(body).slice(0, 40000),
    ]
      .filter(Boolean)
      .join("\n"),
    POSTER_BRIEF_SCHEMA,
  );

  // Si hay una persona protagonista, su foto real entra al póster.
  let photoInputs: GeminiImageInput[] = [];
  let photoCredit = "";
  let photoSource = "";

  if (brief.subject.trim()) {
    try {
      const found = await searchStockPhotos("", brief.subject);
      const photo = found.photos[0];
      const response = await fetch(photo.url, {
        headers: { "user-agent": "OffTheRecord-newsroom/1.0 (https://offtherecord.ec)" },
      });
      if (response.ok) {
        const mimeType = response.headers.get("content-type") || "image/jpeg";
        const data = Buffer.from(await response.arrayBuffer()).toString("base64");
        photoInputs = [{ mimeType, data }];
        photoCredit = photo.credit;
        photoSource = photo.pageUrl;
      }
    } catch (error) {
      // Sin foto no se bloquea el póster: sale la versión sin persona.
      console.warn(`Poster sin foto de "${brief.subject}":`, error instanceof Error ? error.message : error);
    }
  }

  const results = await Promise.allSettled(
    POSTER_STYLES.map(async (style) => {
      const dataUrl = await geminiImage(posterPrompt(brief, style.direction, photoCredit), "4:5", photoInputs);
      const uploaded = await uploadBase64(dataUrl, "image");
      return { ...uploaded, style: style.key, styleLabel: style.label };
    }),
  );

  const posters = results
    .filter((r): r is PromiseFulfilledResult<InfographicPoster> => r.status === "fulfilled")
    .map((r) => r.value);

  if (!posters.length) {
    const first = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    throw new Error(first?.reason instanceof Error ? first.reason.message : "No se pudo generar ningún póster");
  }

  return { brief, posters, ...(photoCredit ? { photoCredit, photoSource } : {}) };
}

/* ------------------------------------------------------------------ */
/* Fotos de archivo (Wikimedia Commons)                                */
/* ------------------------------------------------------------------ */

const PHOTO_QUERY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    query: {
      type: "string",
      description: "Término de búsqueda de foto de archivo: nombre propio de la persona o lugar central del texto, ej. 'Rafael Correa'",
    },
    altText: { type: "string", description: "Descripción accesible en español de la foto que se busca" },
  },
  required: ["query", "altText"],
};

export interface StockPhoto {
  /** URL de la imagen en tamaño de trabajo (~1024 px). */
  url: string;
  /** Página de la foto en Commons, para trazabilidad. */
  pageUrl: string;
  title: string;
  author: string;
  license: string;
  /** Crédito listo para usar como leyenda. */
  credit: string;
}

export interface StockPhotoSet {
  query: string;
  altText: string;
  photos: StockPhoto[];
}

interface CommonsPage {
  title?: string;
  imageinfo?: {
    thumburl?: string;
    url?: string;
    mime?: string;
    descriptionurl?: string;
    extmetadata?: Record<string, { value?: string }>;
  }[];
}

/**
 * Busca fotos reales en Wikimedia Commons: sin clave, con licencia explícita y
 * autor citable — lo que un medio puede publicar legalmente.
 */
export async function searchStockPhotos(body: string, hint = ""): Promise<StockPhotoSet> {
  let query = hint.trim();
  let altText = "";

  if (!query && textProvider()) {
    const built = await completeJson<{ query: string; altText: string }>(
      NEWSROOM_SYSTEM,
      [
        "Del siguiente texto, identifica el mejor término para buscar una foto de archivo periodística.",
        "Prefiere el nombre propio de la persona protagonista; si no hay personas, el lugar o institución central.",
        "",
        stripHtml(body).slice(0, 12000),
      ].join("\n"),
      PHOTO_QUERY_SCHEMA,
      800,
    );
    query = built.query;
    altText = built.altText;
  }

  if (!query) throw new Error("No hay término de búsqueda para la foto");

  const params = new URLSearchParams({
    action: "query",
    format: "json",
    origin: "*",
    generator: "search",
    gsrsearch: `filetype:bitmap ${query}`,
    gsrnamespace: "6",
    gsrlimit: "12",
    prop: "imageinfo",
    iiprop: "url|mime|extmetadata",
    iiurlwidth: "1024",
  });

  const response = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, {
    headers: { "user-agent": "OffTheRecord-newsroom/1.0 (https://offtherecord.ec)" },
  });
  if (!response.ok) throw new Error(`Wikimedia Commons respondió ${response.status}`);

  const payload = (await response.json()) as { query?: { pages?: Record<string, CommonsPage> } };
  const pages = Object.values(payload.query?.pages || {});

  const clean = (html = "") => stripHtml(html).replace(/\s+/g, " ").trim();

  const photos = pages
    .map((page) => {
      const info = page.imageinfo?.[0];
      if (!info?.thumburl || !/^image\/(jpeg|png|webp)$/.test(info.mime || "")) return null;

      const meta = info.extmetadata || {};
      const author = clean(meta.Artist?.value) || "Autor desconocido";
      const license = clean(meta.LicenseShortName?.value) || "Ver licencia en Commons";

      return {
        url: info.thumburl,
        pageUrl: info.descriptionurl || "",
        title: (page.title || "").replace(/^File:/, ""),
        author: author.slice(0, 120),
        license,
        credit: `Foto: ${author.slice(0, 80)} · ${license} · Wikimedia Commons`,
      };
    })
    .filter((p): p is StockPhoto => Boolean(p))
    .slice(0, 3);

  if (!photos.length) throw new Error(`Sin resultados de foto para "${query}"`);

  return { query, altText: altText || `Fotografía de ${query}`, photos };
}

/** Descarga la foto elegida y la deja en Cloudinary como activo propio. */
export async function importStockPhoto(url: string) {
  if (!isCloudinaryConfigured()) throw new AiUnavailableError("almacenamiento");
  if (!/^https:\/\/upload\.wikimedia\.org\//.test(url)) {
    throw new Error("Solo se importan fotos alojadas en Wikimedia");
  }

  const response = await fetch(url, {
    headers: { "user-agent": "OffTheRecord-newsroom/1.0 (https://offtherecord.ec)" },
  });
  if (!response.ok) throw new Error(`No se pudo descargar la foto (${response.status})`);

  const mime = response.headers.get("content-type") || "image/jpeg";
  const buffer = Buffer.from(await response.arrayBuffer());
  return uploadBase64(`data:${mime};base64,${buffer.toString("base64")}`, "image");
}

/** Borra de Cloudinary los candidatos que el editor descartó. */
export async function discardAiAssets(publicIds: string[]) {
  if (!isCloudinaryConfigured() || !publicIds.length) return 0;

  const results = await Promise.allSettled(
    publicIds.map((publicId) => cloudinary.uploader.destroy(publicId, { resource_type: "image" })),
  );

  return results.filter((r) => r.status === "fulfilled").length;
}

const IMAGE_PROMPT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    prompt: { type: "string" },
    altText: { type: "string" },
  },
  required: ["prompt", "altText"],
};

export async function buildImagePrompt(body: string, style = "fotoperiodismo editorial") {
  return completeJson<{ prompt: string; altText: string }>(
    NEWSROOM_SYSTEM,
    [
      `Escribe un prompt en inglés para generar una imagen de portada en estilo ${style}.`,
      "La imagen no debe contener texto ni representar personas reales identificables.",
      "`altText` es la descripción accesible en español.",
      "",
      stripHtml(body).slice(0, 12000),
    ].join("\n"),
    IMAGE_PROMPT_SCHEMA,
    1500,
  );
}

/* ------------------------------------------------------------------ */
/* Multimedia                                                          */
/* ------------------------------------------------------------------ */

async function uploadBase64(dataUrl: string, resourceType: "image" | "video" | "raw") {
  if (!isCloudinaryConfigured()) throw new AiUnavailableError("almacenamiento");

  const result = await cloudinary.uploader.upload(dataUrl, {
    folder: "off-the-record/ai",
    resource_type: resourceType,
  });

  return { url: result.secure_url, publicId: result.public_id, bytes: result.bytes || 0 };
}

async function generateImageWithOpenAI(prompt: string, apiKey: string) {
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: "gpt-image-1", prompt, size: "1536x1024" }),
  });

  if (!response.ok) throw new Error(`OpenAI respondió ${response.status}: ${await response.text()}`);

  const payload = (await response.json()) as { data?: { b64_json?: string }[] };
  const b64 = payload.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI no devolvió una imagen");

  return `data:image/png;base64,${b64}`;
}

export async function generateImage(prompt: string) {
  let dataUrl: string;
  let provider: string;

  if (isGeminiConfigured()) {
    dataUrl = await geminiImage(prompt);
    provider = "gemini";
  } else if (process.env.OPENAI_API_KEY) {
    dataUrl = await generateImageWithOpenAI(prompt, process.env.OPENAI_API_KEY);
    provider = "openai";
  } else {
    throw new AiUnavailableError("imagen");
  }

  const uploaded = await uploadBase64(dataUrl, "image");
  return { ...uploaded, provider };
}

async function generateAudioWithOpenAI(text: string, voice: string, apiKey: string) {
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: "gpt-4o-mini-tts", voice, input: text.slice(0, 4000), response_format: "mp3" }),
  });

  if (!response.ok) throw new Error(`OpenAI TTS respondió ${response.status}: ${await response.text()}`);

  const buffer = Buffer.from(await response.arrayBuffer());
  return `data:audio/mpeg;base64,${buffer.toString("base64")}`;
}

export async function generateAudio(text: string, voice = "") {
  const clean = stripHtml(text).slice(0, 5000);
  let dataUrl: string;
  let provider: string;

  if (isGeminiConfigured()) {
    dataUrl = await geminiSpeech(clean, voice || "Kore");
    provider = "gemini";
  } else if (process.env.OPENAI_API_KEY) {
    dataUrl = await generateAudioWithOpenAI(clean, voice || "alloy", process.env.OPENAI_API_KEY);
    provider = "openai";
  } else {
    throw new AiUnavailableError("audio");
  }

  const uploaded = await uploadBase64(dataUrl, "video");
  return { ...uploaded, provider };
}

const VIDEO_TIMEOUT_MS = Number(process.env.AI_VIDEO_TIMEOUT_MS) || 20000;

export interface VideoResult {
  url: string;
  jobId: string;
  provider: string;
  status: "ready" | "queued";
  publicId?: string;
}

/** Espera a que Veo termine; si tarda más de la cuenta devuelve el trabajo en cola. */
async function waitForVeo(operation: string, deadline: number): Promise<VideoResult> {
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const { done, uri } = await pollGeminiVideo(operation);
    if (!done) continue;
    if (!uri) throw new Error("Veo terminó sin devolver el video");

    const uploaded = await uploadBase64(await downloadGeminiVideo(uri), "video");
    return { url: uploaded.url, publicId: uploaded.publicId, jobId: operation, provider: "gemini", status: "ready" };
  }

  return { url: "", jobId: operation, provider: "gemini", status: "queued" };
}

export async function generateVideo(prompt: string, meta: Record<string, unknown> = {}): Promise<VideoResult> {
  if (isGeminiConfigured()) {
    const operation = await startGeminiVideo(prompt, String(meta.aspectRatio || "16:9"), Number(meta.durationSeconds) || 8);
    return waitForVeo(operation, Date.now() + VIDEO_TIMEOUT_MS);
  }

  const webhook = process.env.AI_VIDEO_WEBHOOK;
  if (!webhook) throw new AiUnavailableError("video");

  const response = await fetch(webhook, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(process.env.AI_VIDEO_WEBHOOK_TOKEN ? { authorization: `Bearer ${process.env.AI_VIDEO_WEBHOOK_TOKEN}` } : {}),
    },
    body: JSON.stringify({ prompt, ...meta }),
  });

  if (!response.ok) throw new Error(`El servicio de video respondió ${response.status}`);

  const payload = (await response.json().catch(() => ({}))) as { url?: string; jobId?: string };

  return {
    url: payload.url || "",
    jobId: payload.jobId || "",
    provider: "webhook",
    status: payload.url ? "ready" : "queued",
  };
}

/** Retoma un trabajo de video que quedó en cola. */
export async function resumeVideo(operation: string): Promise<VideoResult> {
  if (!isGeminiConfigured()) throw new AiUnavailableError("video");

  const { done, uri } = await pollGeminiVideo(operation);
  if (!done) return { url: "", jobId: operation, provider: "gemini", status: "queued" };
  if (!uri) throw new Error("Veo terminó sin devolver el video");

  const uploaded = await uploadBase64(await downloadGeminiVideo(uri), "video");
  return { url: uploaded.url, publicId: uploaded.publicId, jobId: operation, provider: "gemini", status: "ready" };
}

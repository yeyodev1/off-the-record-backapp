import Anthropic from "@anthropic-ai/sdk";
import { cloudinary, isCloudinaryConfigured } from "../config/cloudinary";
import { stripHtml } from "./content.service";
import {
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

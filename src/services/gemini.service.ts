/**
 * Cliente de la API de Gemini (Google AI Studio).
 *
 * Una sola clave — GOOGLE_API_KEY — cubre las cuatro capacidades que pide la
 * redacción: texto con salida estructurada, imágenes, audio (TTS) y video (Veo).
 */

const BASE = "https://generativelanguage.googleapis.com/v1beta";

export const GEMINI_MODELS = {
  text: process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash",
  textPro: process.env.GEMINI_TEXT_PRO_MODEL || "gemini-2.5-pro",
  image: process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image",
  tts: process.env.GEMINI_TTS_MODEL || "gemini-2.5-flash-preview-tts",
  video: process.env.GEMINI_VIDEO_MODEL || "veo-3.1-generate-preview",
};

export function geminiKey() {
  return process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || "";
}

export function isGeminiConfigured() {
  return Boolean(geminiKey());
}

interface GeminiPart {
  text?: string;
  inlineData?: { data: string; mimeType: string };
}

interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
}

async function call(model: string, method: string, payload: unknown) {
  const key = geminiKey();
  if (!key) throw new Error("GOOGLE_API_KEY no está configurada");

  const response = await fetch(`${BASE}/models/${model}:${method}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify(payload),
  });

  const body = (await response.json().catch(() => ({}))) as GeminiResponse;

  if (!response.ok) {
    throw new Error(body?.error?.message || `Gemini respondió ${response.status}`);
  }

  return body;
}

function firstText(body: GeminiResponse) {
  const parts = body.candidates?.[0]?.content?.parts || [];
  const text = parts
    .map((part) => part.text || "")
    .join("")
    .trim();

  if (!text) {
    const reason = body.promptFeedback?.blockReason || body.candidates?.[0]?.finishReason;
    throw new Error(reason ? `Gemini no devolvió texto (${reason})` : "Gemini no devolvió texto");
  }

  return text;
}

function firstInline(body: GeminiResponse) {
  const parts = body.candidates?.[0]?.content?.parts || [];
  const inline = parts.find((part) => part.inlineData)?.inlineData;
  if (!inline) throw new Error("Gemini no devolvió contenido binario");
  return inline;
}

/* ------------------------------------------------------------------ */
/* Texto                                                               */
/* ------------------------------------------------------------------ */

export async function geminiText(system: string, prompt: string, maxTokens = 2048) {
  const body = await call(GEMINI_MODELS.text, "generateContent", {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: maxTokens, temperature: 0.4 },
  });

  return firstText(body);
}

/**
 * El `responseSchema` de Gemini usa tipos en mayúsculas (OBJECT, STRING…) y no
 * admite `additionalProperties`, así que traducimos el JSON Schema estándar.
 */
export function toGeminiSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const TYPES: Record<string, string> = {
    object: "OBJECT",
    array: "ARRAY",
    string: "STRING",
    number: "NUMBER",
    integer: "INTEGER",
    boolean: "BOOLEAN",
  };

  const out: Record<string, unknown> = {};

  if (typeof schema.type === "string") out.type = TYPES[schema.type] || "STRING";
  if (schema.description) out.description = schema.description;
  if (Array.isArray(schema.enum)) out.enum = schema.enum;
  if (Array.isArray(schema.required)) out.required = schema.required;

  if (schema.properties && typeof schema.properties === "object") {
    out.properties = Object.fromEntries(
      Object.entries(schema.properties as Record<string, Record<string, unknown>>).map(([name, value]) => [
        name,
        toGeminiSchema(value),
      ]),
    );
    // Gemini respeta el orden declarado, lo que mejora la consistencia.
    out.propertyOrdering = Object.keys(schema.properties as Record<string, unknown>);
  }

  if (schema.items && typeof schema.items === "object") {
    out.items = toGeminiSchema(schema.items as Record<string, unknown>);
  }

  return out;
}

export async function geminiJson<T>(
  system: string,
  prompt: string,
  schema: Record<string, unknown>,
  maxTokens = 4096,
): Promise<T> {
  const body = await call(GEMINI_MODELS.text, "generateContent", {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature: 0.3,
      responseMimeType: "application/json",
      responseSchema: toGeminiSchema(schema),
    },
  });

  const raw = firstText(body);

  try {
    return JSON.parse(raw) as T;
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1)) as T;
    throw new Error("Gemini devolvió un JSON inválido");
  }
}

/* ------------------------------------------------------------------ */
/* Imagen                                                              */
/* ------------------------------------------------------------------ */

export async function geminiImage(prompt: string) {
  const body = await call(GEMINI_MODELS.image, "generateContent", {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ["IMAGE"] },
  });

  const inline = firstInline(body);
  return `data:${inline.mimeType};base64,${inline.data}`;
}

/* ------------------------------------------------------------------ */
/* Audio (TTS)                                                         */
/* ------------------------------------------------------------------ */

/**
 * Gemini TTS devuelve PCM crudo (`audio/L16;rate=24000`), que ningún navegador
 * reproduce por sí solo. Le anteponemos una cabecera WAV de 44 bytes.
 */
function pcmToWav(pcm: Buffer, sampleRate: number, channels = 1, bitsPerSample = 16) {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // tamaño del bloque fmt
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}

export async function geminiSpeech(text: string, voice = "Kore") {
  const body = await call(GEMINI_MODELS.tts, "generateContent", {
    contents: [{ role: "user", parts: [{ text }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
    },
  });

  const inline = firstInline(body);
  const rate = Number(/rate=(\d+)/.exec(inline.mimeType)?.[1]) || 24000;
  const wav = pcmToWav(Buffer.from(inline.data, "base64"), rate);

  return `data:audio/wav;base64,${wav.toString("base64")}`;
}

/* ------------------------------------------------------------------ */
/* Video (Veo)                                                         */
/* ------------------------------------------------------------------ */

interface VeoOperation {
  name?: string;
  done?: boolean;
  error?: { message?: string };
  response?: {
    generateVideoResponse?: { generatedSamples?: { video?: { uri?: string } }[] };
    generatedVideos?: { video?: { uri?: string } }[];
  };
}

function videoUriOf(operation: VeoOperation) {
  return (
    operation.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri ||
    operation.response?.generatedVideos?.[0]?.video?.uri ||
    ""
  );
}

export async function startGeminiVideo(prompt: string, aspectRatio = "16:9", durationSeconds = 8) {
  const body = (await call(GEMINI_MODELS.video, "predictLongRunning", {
    instances: [{ prompt }],
    parameters: { aspectRatio, durationSeconds },
  })) as unknown as VeoOperation;

  if (!body.name) throw new Error("Veo no devolvió un identificador de trabajo");
  return body.name;
}

export async function pollGeminiVideo(operationName: string) {
  const key = geminiKey();
  const response = await fetch(`${BASE}/${operationName}`, { headers: { "x-goog-api-key": key } });
  const body = (await response.json().catch(() => ({}))) as VeoOperation;

  if (!response.ok) throw new Error(body?.error?.message || `Veo respondió ${response.status}`);
  if (body.error?.message) throw new Error(body.error.message);

  return { done: Boolean(body.done), uri: videoUriOf(body) };
}

/** Descarga el video ya renderizado y lo devuelve como data URL. */
export async function downloadGeminiVideo(uri: string) {
  // La URI redirige a una URL firmada; fetch sigue los redirects por defecto.
  const response = await fetch(uri, { headers: { "x-goog-api-key": geminiKey() } });

  if (!response.ok) throw new Error(`No se pudo descargar el video (${response.status})`);

  const buffer = Buffer.from(await response.arrayBuffer());
  return `data:video/mp4;base64,${buffer.toString("base64")}`;
}

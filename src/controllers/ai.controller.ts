import { Response } from "express";
import { AuthRequest } from "../types/AuthRequest";
import { CustomError } from "../errors/customError.error";
import {
  AiUnavailableError,
  aiCapabilities,
  buildImagePrompt,
  generateAudio,
  generateHeadlines,
  generateImage,
  generateInfographic,
  generateIntertitles,
  generateSummary,
  generateVideo,
  resumeVideo,
} from "../services/ai.service";
import { proofread } from "../services/spellcheck.service";
import { UploadModel } from "../models/upload.model";

type AnyRecord = Record<string, unknown>;

function requireBody(req: AuthRequest, field: string) {
  const value = (req.body as AnyRecord)[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new CustomError(`El campo "${field}" es obligatorio`, 400);
  }
  return value;
}

async function guard<T>(capability: string, task: () => Promise<T>): Promise<T> {
  try {
    return await task();
  } catch (error) {
    if (error instanceof AiUnavailableError) {
      throw new CustomError(error.message, 503);
    }
    console.error(`AI ${capability} failed`, error);
    throw new CustomError(error instanceof Error ? error.message : `Falló la generación de ${capability}`, 502);
  }
}

export async function capabilities(_req: AuthRequest, res: Response) {
  res.json({ data: aiCapabilities() });
}

export async function summary(req: AuthRequest, res: Response) {
  const body = requireBody(req, "body");
  const text = await guard("resumen", () => generateSummary(body));
  res.json({ data: { text } });
}

export async function intertitles(req: AuthRequest, res: Response) {
  const body = requireBody(req, "body");
  const data = await guard("intertítulos", () => generateIntertitles(body));
  res.json({ data });
}

export async function headlines(req: AuthRequest, res: Response) {
  const body = requireBody(req, "body");
  const data = await guard("titulares", () => generateHeadlines(body));
  res.json({ data });
}

export async function infographic(req: AuthRequest, res: Response) {
  const body = requireBody(req, "body");
  const hint = String((req.body as AnyRecord).hint || "");
  const data = await guard("infografía", () => generateInfographic(body, hint));
  res.json({ data });
}

export async function image(req: AuthRequest, res: Response) {
  const { prompt, body, style } = req.body as AnyRecord;

  let finalPrompt = typeof prompt === "string" ? prompt.trim() : "";
  let altText = String((req.body as AnyRecord).altText || "");

  if (!finalPrompt) {
    if (typeof body !== "string" || !body.trim()) {
      throw new CustomError('Envía "prompt" o "body" para generar la imagen', 400);
    }
    const built = await guard("prompt de imagen", () => buildImagePrompt(body, String(style || "fotoperiodismo editorial")));
    finalPrompt = built.prompt;
    altText = built.altText;
  }

  const result = await guard("imagen", () => generateImage(finalPrompt));

  await UploadModel.create({
    url: result.url,
    name: altText || "Imagen generada por IA",
    kind: "image",
    provider: result.provider,
    publicId: result.publicId,
    bytes: result.bytes,
    source: "ai",
    userId: req.user!.userId,
  });

  res.status(201).json({ data: { ...result, prompt: finalPrompt, altText } });
}

export async function audio(req: AuthRequest, res: Response) {
  const body = requireBody(req, "body");
  const voice = String((req.body as AnyRecord).voice || "");
  const result = await guard("audio", () => generateAudio(body, voice));

  await UploadModel.create({
    url: result.url,
    name: String((req.body as AnyRecord).name || "Audio generado por IA"),
    kind: "audio",
    provider: result.provider,
    publicId: result.publicId,
    bytes: result.bytes,
    source: "ai",
    userId: req.user!.userId,
  });

  res.status(201).json({ data: result });
}

export async function video(req: AuthRequest, res: Response) {
  const prompt = requireBody(req, "prompt");
  const result = await guard("video", () => generateVideo(prompt, { requestedBy: req.user!.email }));

  if (result.url) {
    await UploadModel.create({
      url: result.url,
      name: String((req.body as AnyRecord).name || "Video generado por IA"),
      kind: "video",
      provider: result.provider,
      source: "ai",
      userId: req.user!.userId,
    });
  }

  res.status(201).json({ data: result });
}

/** Retoma un render de Veo que quedó en cola. */
export async function videoStatus(req: AuthRequest, res: Response) {
  const operation = String((req.body as AnyRecord).operation || (req.query.operation as string) || "");
  if (!operation) throw new CustomError('Falta el identificador del trabajo', 400);

  const result = await guard("video", () => resumeVideo(operation));

  if (result.status === "ready" && result.url) {
    await UploadModel.create({
      url: result.url,
      name: String((req.body as AnyRecord).name || "Video generado por IA"),
      kind: "video",
      provider: result.provider,
      publicId: result.publicId || "",
      source: "ai",
      userId: req.user!.userId,
    });
  }

  res.json({ data: result });
}

export async function spellcheck(req: AuthRequest, res: Response) {
  const body = requireBody(req, "body");
  res.json({ data: proofread(body) });
}

import { Response } from "express";
import { UploadModel } from "../models/upload.model";
import { AuthRequest } from "../types/AuthRequest";
import { CustomError } from "../errors/customError.error";
import { cloudinary, isCloudinaryConfigured } from "../config/cloudinary";

const MAX_DATA_URL_SIZE = 45 * 1024 * 1024;

type AssetKind = "image" | "video" | "audio" | "document";

function detectKind(mime: string): AssetKind {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
}

function resourceTypeFor(kind: AssetKind) {
  if (kind === "image") return "image" as const;
  if (kind === "video" || kind === "audio") return "video" as const;
  return "raw" as const;
}

export async function uploadToCloudinary(req: AuthRequest, res: Response) {
  if (!isCloudinaryConfigured()) {
    throw new CustomError("Cloudinary no está configurado", 503);
  }

  const { file, name } = req.body as Record<string, unknown>;

  if (typeof file !== "string" || !file.startsWith("data:")) {
    throw new CustomError("Se requiere un archivo en formato data URL base64", 400);
  }
  if (file.length > MAX_DATA_URL_SIZE) {
    throw new CustomError("El archivo es demasiado grande. Máximo 30 MB", 413);
  }

  const mime = file.slice(5, file.indexOf(";")) || "application/octet-stream";
  const kind = detectKind(mime);

  let result;
  try {
    result = await cloudinary.uploader.upload(file, {
      folder: "off-the-record",
      resource_type: resourceTypeFor(kind),
    });
  } catch (error) {
    console.error("Cloudinary upload failed", error);
    throw new CustomError(
      "Cloudinary rechazó la subida. Verifica CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY y CLOUDINARY_API_SECRET",
      502,
    );
  }

  const upload = await UploadModel.create({
    url: result.secure_url,
    name: typeof name === "string" && name.trim() ? name.trim() : result.original_filename || "archivo",
    kind,
    mime,
    bytes: result.bytes || 0,
    provider: "cloudinary",
    publicId: result.public_id,
    source: "upload",
    userId: req.user!.userId,
  });

  res.status(201).json({ data: { url: result.secure_url, kind, upload } });
}

export async function listUploads(req: AuthRequest, res: Response) {
  const kind = String(req.query.kind || "").trim();
  const filter: Record<string, unknown> = {};
  if (["image", "video", "audio", "document"].includes(kind)) filter.kind = kind;

  const data = await UploadModel.find(filter).sort({ createdAt: -1 }).limit(120);
  res.json({ data });
}

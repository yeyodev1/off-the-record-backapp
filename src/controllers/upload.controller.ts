import { Response } from "express";
import { UploadModel } from "../models/upload.model";
import { AuthRequest } from "../types/AuthRequest";
import { CustomError } from "../errors/customError.error";
import { cloudinary, isCloudinaryConfigured } from "../config/cloudinary";

const MAX_DATA_URL_SIZE = 10 * 1024 * 1024;

export async function uploadToCloudinary(req: AuthRequest, res: Response) {
  if (!isCloudinaryConfigured()) {
    throw new CustomError("Cloudinary is not configured", 503);
  }

  const { file, name } = req.body as Record<string, unknown>;
  if (typeof file !== "string" || !file.startsWith("data:")) {
    throw new CustomError("A base64 data URL file is required", 400);
  }
  if (file.length > MAX_DATA_URL_SIZE) {
    throw new CustomError("File is too large. Maximum upload size is 10 MB", 413);
  }

  const result = await cloudinary.uploader.upload(file, {
    folder: "off-the-record",
    resource_type: "image",
  });
  const upload = await UploadModel.create({
    url: result.secure_url,
    name: typeof name === "string" && name.trim() ? name.trim() : result.original_filename,
    userId: req.user!.userId,
  });

  res.status(201).json({ data: { url: result.secure_url, upload } });
}

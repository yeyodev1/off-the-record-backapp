import { Response } from "express";
import { isValidObjectId } from "mongoose";
import { AuthRequest } from "../types/AuthRequest";
import { CustomError } from "../errors/customError.error";
import { contentReceipts, inactiveReaders, notificationReceipts } from "../services/receipts.service";
import { ArticleModel } from "../models/article.model";
import { UpdateModel } from "../models/update.model";

export async function articleReceipts(req: AuthRequest, res: Response) {
  const id = String(req.params.id || "");
  if (!isValidObjectId(id)) throw new CustomError("Identificador inválido", 400);

  const article = await ArticleModel.findById(id).select("title status publishedAt");
  if (!article) throw new CustomError("Reportaje no encontrado", 404);

  const receipts = await contentReceipts("article", id);
  res.json({ data: { ...receipts, title: article.title, status: article.status } });
}

export async function updateReceipts(req: AuthRequest, res: Response) {
  const id = String(req.params.id || "");
  if (!isValidObjectId(id)) throw new CustomError("Identificador inválido", 400);

  const update = await UpdateModel.findById(id).select("title status publishedAt");
  if (!update) throw new CustomError("Actualización no encontrada", 404);

  const receipts = await contentReceipts("update", id);
  res.json({ data: { ...receipts, title: update.title, status: update.status } });
}

export async function notificationReceiptsHandler(req: AuthRequest, res: Response) {
  const id = String(req.params.id || "");
  if (!isValidObjectId(id)) throw new CustomError("Identificador inválido", 400);

  res.json({ data: await notificationReceipts(id) });
}

export async function inactive(req: AuthRequest, res: Response) {
  const days = Number(req.query.days);
  res.json({ data: await inactiveReaders(Number.isFinite(days) && days > 0 ? days : 14) });
}

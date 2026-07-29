import { Response } from "express";
import { ArticleModel } from "../models/article.model";
import { AuthRequest } from "../types/AuthRequest";
import { CustomError } from "../errors/customError.error";
import { publishDueArticles } from "../services/articlePublication.service";

const editableFields = ["title", "key", "summary", "description", "observations", "photo", "typeId", "status", "scheduledFor"];
type ArticleStatus = "draft" | "scheduled" | "published";

function getStatus(value: unknown): ArticleStatus {
  if (value === "draft" || value === "scheduled" || value === "published") return value;
  return "draft";
}

function getPayload(body: Record<string, unknown>) {
  const payload: Record<string, unknown> = {};

  for (const field of editableFields) {
    if (field in body) payload[field] = body[field];
  }

  const status = getStatus(payload.status);
  payload.status = status;

  if (status === "scheduled") {
    const scheduledFor = new Date(String(payload.scheduledFor || ""));
    if (Number.isNaN(scheduledFor.getTime()) || scheduledFor <= new Date()) {
      throw new CustomError("A future scheduledFor date is required for scheduled articles", 400);
    }
    payload.scheduledFor = scheduledFor;
    payload.publishedAt = null;
  } else if (status === "published") {
    payload.publishedAt = new Date();
    payload.scheduledFor = null;
  } else {
    payload.scheduledFor = null;
    payload.publishedAt = null;
  }

  return payload;
}

export async function listArticles(req: AuthRequest, res: Response) {
  await publishDueArticles();
  const search = String(req.query.search || "").trim();
  const filter = search
    ? { $or: ["title", "summary", "description"].map((field) => ({ [field]: { $regex: search, $options: "i" } })) }
    : {};
  const data = await ArticleModel.find(filter).sort({ updatedAt: -1 });
  res.json({ data, total: data.length, page: 1, limit: data.length });
}

export async function listPublicArticles(_req: AuthRequest, res: Response) {
  await publishDueArticles();
  const data = await ArticleModel.find({ status: "published" }).sort({ publishedAt: -1 }).select("-authorId");
  res.json({ data });
}

export async function getArticle(req: AuthRequest, res: Response) {
  const article = await ArticleModel.findById(req.params.id);
  if (!article) throw new CustomError("Article not found", 404);

  if (req.user!.roleId !== 1 && article.authorId !== req.user!.userId) {
    throw new CustomError("You can only view your own articles", 403);
  }

  res.json({ data: article });
}

export async function createArticle(req: AuthRequest, res: Response) {
  const payload = getPayload(req.body as Record<string, unknown>);
  if (!payload.title) throw new CustomError("title is required", 400);

  const article = await ArticleModel.create({
    ...payload,
    authorId: req.user!.userId,
    authorName: req.user!.email,
  });
  res.status(201).json({ data: article, message: "Article created" });
}

export async function updateArticle(req: AuthRequest, res: Response) {
  const article = await ArticleModel.findById(req.params.id);
  if (!article) throw new CustomError("Article not found", 404);

  if (req.user!.roleId !== 1 && article.authorId !== req.user!.userId) {
    throw new CustomError("You can only edit your own articles", 403);
  }

  const payload = getPayload({ ...article.toObject(), ...(req.body as Record<string, unknown>) });
  const updated = await ArticleModel.findByIdAndUpdate(req.params.id, payload, { new: true, runValidators: true });
  res.json({ data: updated, message: "Article updated" });
}

export async function deleteArticle(req: AuthRequest, res: Response) {
  const article = await ArticleModel.findById(req.params.id);
  if (!article) throw new CustomError("Article not found", 404);

  if (req.user!.roleId !== 1 && article.authorId !== req.user!.userId) {
    throw new CustomError("You can only delete your own articles", 403);
  }

  await article.deleteOne();
  res.json({ message: "Article deleted" });
}

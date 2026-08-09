import { Response } from "express";
import { isValidObjectId } from "mongoose";
import { AuthRequest } from "../types/AuthRequest";
import { CustomError } from "../errors/customError.error";
import { TagModel } from "../models/tag.model";
import { slugify } from "../services/content.service";
import { mergeTags, recountAllTags, removeTag, renameTag, resolveTags } from "../services/tag.service";

export async function listTags(req: AuthRequest, res: Response) {
  const search = String(req.query.search || "").trim();
  const filter: Record<string, unknown> = {};

  if (search) {
    // Buscamos por slug para que la tilde o la mayúscula no impidan encontrarla.
    filter.$or = [
      { name: { $regex: search, $options: "i" } },
      { slug: { $regex: slugify(search), $options: "i" } },
    ];
  }

  const data = await TagModel.find(filter).sort({ usageCount: -1, name: 1 }).limit(400);
  res.json({ data, total: data.length });
}

export async function createTag(req: AuthRequest, res: Response) {
  const name = String((req.body as Record<string, unknown>).name || "").trim();
  if (!name) throw new CustomError("El nombre de la etiqueta es obligatorio", 400);

  const slug = slugify(name);
  if (!slug) throw new CustomError("El nombre no genera una etiqueta válida", 400);

  const existing = await TagModel.findOne({ slug });
  if (existing) {
    // No es un error: devolvemos la canónica para que el editor la reutilice.
    res.json({ data: existing, message: `Ya existía como «${existing.name}»`, reused: true });
    return;
  }

  const { slugs } = await resolveTags([name], { userId: req.user!.userId, email: req.user!.email });
  const created = await TagModel.findOne({ slug: slugs[0] });

  const body = req.body as Record<string, unknown>;
  if (created && (body.color || body.description)) {
    if (body.color) created.color = String(body.color);
    if (body.description) created.description = String(body.description);
    await created.save();
  }

  res.status(201).json({ data: created, message: "Etiqueta creada", reused: false });
}

export async function updateTag(req: AuthRequest, res: Response) {
  const id = String(req.params.id || "");
  if (!isValidObjectId(id)) throw new CustomError("Identificador inválido", 400);

  const body = req.body as Record<string, unknown>;
  let tag = await TagModel.findById(id);
  if (!tag) throw new CustomError("Etiqueta no encontrada", 404);

  if (typeof body.name === "string" && body.name.trim() && body.name.trim() !== tag.name) {
    tag = await renameTag(id, body.name.trim());
    if (!tag) throw new CustomError("Etiqueta no encontrada", 404);
  }

  if (body.color !== undefined) tag.color = String(body.color);
  if (body.description !== undefined) tag.description = String(body.description);
  if (body.active !== undefined) tag.active = Boolean(body.active);
  await tag.save();

  res.json({ data: tag, message: "Etiqueta actualizada" });
}

export async function mergeTagHandler(req: AuthRequest, res: Response) {
  const id = String(req.params.id || "");
  const into = String((req.body as Record<string, unknown>).into || "");

  if (!isValidObjectId(id) || !isValidObjectId(into)) {
    throw new CustomError("Identificadores inválidos", 400);
  }

  const merged = await mergeTags(id, into);
  if (!merged) throw new CustomError("Etiqueta no encontrada", 404);

  res.json({ data: merged, message: `Etiquetas fusionadas en «${merged.name}»` });
}

export async function deleteTag(req: AuthRequest, res: Response) {
  const id = String(req.params.id || "");
  if (!isValidObjectId(id)) throw new CustomError("Identificador inválido", 400);

  const removed = await removeTag(id);
  if (!removed) throw new CustomError("Etiqueta no encontrada", 404);

  res.json({ message: "Etiqueta eliminada" });
}

export async function recountTagsHandler(_req: AuthRequest, res: Response) {
  await recountAllTags();
  const data = await TagModel.find({}).sort({ usageCount: -1, name: 1 });
  res.json({ data, message: "Conteos actualizados" });
}

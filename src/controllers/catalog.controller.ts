import { Response } from "express";
import { isValidObjectId } from "mongoose";
import { AuthRequest } from "../types/AuthRequest";
import { CustomError } from "../errors/customError.error";
import { CategoryModel } from "../models/category.model";
import { IndicatorModel } from "../models/indicator.model";
import { slugify } from "../services/content.service";
import { SOURCE_PRESETS } from "../services/indicatorSource.service";
import { syncDueIndicators, syncIndicator } from "../services/indicatorSync.service";

type AnyRecord = Record<string, unknown>;

/* ------------------------------------------------------------------ */
/* Categorías (secciones de contenido y segmentos de audiencia)        */
/* ------------------------------------------------------------------ */

export async function listCategories(req: AuthRequest, res: Response) {
  const scope = String(req.query.scope || "").trim();
  const filter: AnyRecord = {};
  if (scope === "content" || scope === "audience") filter.scope = scope;

  const data = await CategoryModel.find(filter).sort({ scope: 1, order: 1, name: 1 });
  res.json({ data });
}

export async function createCategory(req: AuthRequest, res: Response) {
  const body = req.body as AnyRecord;
  if (!body.name) throw new CustomError("El nombre es obligatorio", 400);

  const created = await CategoryModel.create({
    name: body.name,
    slug: slugify(String(body.name)),
    scope: body.scope === "audience" ? "audience" : "content",
    color: body.color || "#C8392B",
    icon: body.icon || "fa-solid fa-layer-group",
    description: body.description || "",
    order: Number(body.order) || 0,
    active: body.active !== false,
  });

  res.status(201).json({ data: created, message: "Categoría creada" });
}

export async function updateCategory(req: AuthRequest, res: Response) {
  const { id } = req.params;
  if (!isValidObjectId(id)) throw new CustomError("Identificador inválido", 400);

  const body = req.body as AnyRecord;
  const payload: AnyRecord = {};

  for (const field of ["name", "color", "icon", "description", "order", "active", "scope"]) {
    if (field in body) payload[field] = body[field];
  }
  if (payload.name) payload.slug = slugify(String(payload.name));

  const updated = await CategoryModel.findByIdAndUpdate(id, payload, { new: true, runValidators: true });
  if (!updated) throw new CustomError("Categoría no encontrada", 404);

  res.json({ data: updated, message: "Categoría actualizada" });
}

export async function deleteCategory(req: AuthRequest, res: Response) {
  const { id } = req.params;
  if (!isValidObjectId(id)) throw new CustomError("Identificador inválido", 400);

  const removed = await CategoryModel.findByIdAndDelete(id);
  if (!removed) throw new CustomError("Categoría no encontrada", 404);

  res.json({ message: "Categoría eliminada" });
}

/* ------------------------------------------------------------------ */
/* Indicadores económicos                                              */
/* ------------------------------------------------------------------ */

export async function listIndicators(_req: AuthRequest, res: Response) {
  const data = await IndicatorModel.find({}).sort({ order: 1, name: 1 });
  res.json({ data });
}

export async function createIndicator(req: AuthRequest, res: Response) {
  const body = req.body as AnyRecord;
  if (!body.name || body.value === undefined) {
    throw new CustomError("Nombre y valor son obligatorios", 400);
  }

  const value = Number(body.value);
  if (!Number.isFinite(value)) throw new CustomError("El valor debe ser numérico", 400);

  const created = await IndicatorModel.create({
    name: body.name,
    code: body.code || slugify(String(body.name)).toUpperCase(),
    value,
    previousValue: null,
    unit: body.unit || "",
    format: ["number", "currency", "percent"].includes(String(body.format)) ? body.format : "number",
    source: body.source || "",
    color: body.color || "#C9A84C",
    order: Number(body.order) || 0,
    active: body.active !== false,
    history: [{ value, at: new Date() }],
    measuredAt: new Date(),
    feed: normalizeFeed(body.feed),
  });

  // Si nace conectado, traemos el valor real de una vez.
  if (created.feed?.provider && created.feed.provider !== "manual") {
    await syncIndicator(String(created._id), true);
  }

  res.status(201).json({ data: created, message: "Indicador creado" });
}

export async function updateIndicator(req: AuthRequest, res: Response) {
  const { id } = req.params;
  if (!isValidObjectId(id)) throw new CustomError("Identificador inválido", 400);

  const indicator = await IndicatorModel.findById(id);
  if (!indicator) throw new CustomError("Indicador no encontrado", 404);

  const body = req.body as AnyRecord;

  if (body.value !== undefined) {
    const value = Number(body.value);
    if (!Number.isFinite(value)) throw new CustomError("El valor debe ser numérico", 400);

    if (value !== indicator.value) {
      indicator.previousValue = indicator.value;
      indicator.history.push({ value, at: new Date() });
      if (indicator.history.length > 60) {
        indicator.history.splice(0, indicator.history.length - 60);
      }
      indicator.value = value;
      indicator.measuredAt = new Date();
    }
  }

  for (const field of ["name", "code", "unit", "format", "source", "color", "order", "active"] as const) {
    if (field in body) (indicator as unknown as AnyRecord)[field] = body[field];
  }

  if ("feed" in body) {
    (indicator as unknown as AnyRecord).feed = normalizeFeed(body.feed);
  }

  await indicator.save();
  res.json({ data: indicator, message: "Indicador actualizado" });
}

const PROVIDERS = ["manual", "bce", "sri", "yahoo", "worldbank", "frankfurter", "json"];

/** Sanea lo que llega del panel antes de guardarlo como conexión. */
function normalizeFeed(raw: unknown) {
  const input = (raw || {}) as AnyRecord;
  const provider = PROVIDERS.includes(String(input.provider)) ? String(input.provider) : "manual";

  return {
    provider,
    symbol: String(input.symbol || "").trim(),
    url: String(input.url || "").trim(),
    path: String(input.path || "").trim(),
    multiplier: Number(input.multiplier) || 1,
    refreshHours: Math.max(1, Math.min(168, Number(input.refreshHours) || 6)),
  };
}

export async function indicatorPresets(_req: AuthRequest, res: Response) {
  res.json({ data: SOURCE_PRESETS });
}

/** Sincroniza uno concreto, o todos si no llega id. */
export async function syncIndicators(req: AuthRequest, res: Response) {
  const id = String(req.params.id || "");

  if (id) {
    if (!isValidObjectId(id)) throw new CustomError("Identificador inválido", 400);

    const result = await syncIndicator(id, true);
    if (result.status === "error") throw new CustomError(result.message || "No se pudo sincronizar", 502);

    const data = await IndicatorModel.findById(id);
    res.json({ data, message: result.status === "skipped" ? result.message : "Indicador actualizado" });
    return;
  }

  const results = await syncDueIndicators(true);
  const data = await IndicatorModel.find({}).sort({ order: 1, name: 1 });
  const updated = results.filter((result) => result.status === "ok").length;
  const failed = results.filter((result) => result.status === "error");

  res.json({
    data,
    results,
    message: failed.length
      ? `${updated} actualizados, ${failed.length} con error`
      : `${updated} indicadores actualizados`,
  });
}

export async function deleteIndicator(req: AuthRequest, res: Response) {
  const { id } = req.params;
  if (!isValidObjectId(id)) throw new CustomError("Identificador inválido", 400);

  const removed = await IndicatorModel.findByIdAndDelete(id);
  if (!removed) throw new CustomError("Indicador no encontrado", 404);

  res.json({ message: "Indicador eliminado" });
}

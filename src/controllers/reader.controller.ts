import { Response } from "express";
import { AuthRequest } from "../types/AuthRequest";
import { ArticleModel } from "../models/article.model";
import { UpdateModel } from "../models/update.model";
import { CategoryModel } from "../models/category.model";
import { TagModel } from "../models/tag.model";

const PUBLISHED = { status: "published" };

/**
 * Los contadores son iguales para todo el mundo y sólo cambian al publicar,
 * pero salen de siete agregaciones sobre miles de documentos: era la llamada
 * más lenta de la vista del lector. Se cachean un minuto.
 */
const CACHE_MS = 60_000;
let cache: { at: number; data: unknown } | null = null;

/** La llama el planificador al publicar algo, para no servir cifras viejas. */
export function invalidateFacets() {
  cache = null;
}

interface Bucket {
  _id: string;
  count: number;
}

/**
 * Contadores para la barra lateral del lector. Se resuelve con agregaciones,
 * no trayendo el catálogo: la barra tiene que ser barata porque se pinta en
 * todas las vistas.
 */
export async function readerFacets(_req: AuthRequest, res: Response) {
  if (cache && Date.now() - cache.at < CACHE_MS) {
    res.json({ data: cache.data });
    return;
  }

  const [articles, updates, categoryDocs, articleCats, updateCats, articleTags, updateTags] = await Promise.all([
    ArticleModel.countDocuments(PUBLISHED),
    UpdateModel.countDocuments(PUBLISHED),
    CategoryModel.find({ scope: "content" }).sort({ order: 1, name: 1 }),
    ArticleModel.aggregate<Bucket>([{ $match: PUBLISHED }, { $group: { _id: "$categoryId", count: { $sum: 1 } } }]),
    UpdateModel.aggregate<Bucket>([{ $match: PUBLISHED }, { $group: { _id: "$categoryId", count: { $sum: 1 } } }]),
    ArticleModel.aggregate<Bucket>([
      { $match: PUBLISHED },
      { $unwind: "$tagSlugs" },
      { $group: { _id: "$tagSlugs", count: { $sum: 1 } } },
    ]),
    UpdateModel.aggregate<Bucket>([
      { $match: PUBLISHED },
      { $unwind: "$tagSlugs" },
      { $group: { _id: "$tagSlugs", count: { $sum: 1 } } },
    ]),
  ]);

  const sum = (buckets: Bucket[]) => {
    const totals = new Map<string, number>();
    for (const bucket of buckets) {
      if (!bucket._id) continue;
      totals.set(String(bucket._id), (totals.get(String(bucket._id)) || 0) + bucket.count);
    }
    return totals;
  };

  const perCategory = sum([...articleCats, ...updateCats]);
  const perTag = sum([...articleTags, ...updateTags]);

  // Sólo se ofrecen secciones con algo publicado: un menú con ceros no sirve.
  const categories = categoryDocs
    .map((category) => ({
      _id: String(category._id),
      name: category.name,
      color: category.color,
      icon: category.icon,
      count: perCategory.get(String(category._id)) || 0,
    }))
    .filter((category) => category.count > 0);

  const ranked = [...perTag.entries()]
    .map(([slug, count]) => ({ slug, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  // El slug no se muestra: el nombre bonito vive en el catálogo de etiquetas.
  const named = await TagModel.find({ slug: { $in: ranked.map((entry) => entry.slug) } }).select("name slug color");
  const labels = new Map(named.map((tag) => [tag.slug, { name: tag.name, color: tag.color }]));

  const tags = ranked.map((entry) => ({
    ...entry,
    name: labels.get(entry.slug)?.name || entry.slug,
    color: labels.get(entry.slug)?.color || "",
  }));

  const data = {
    counts: { all: articles + updates, article: articles, update: updates },
    categories,
    tags,
  };

  cache = { at: Date.now(), data };
  res.json({ data });
}

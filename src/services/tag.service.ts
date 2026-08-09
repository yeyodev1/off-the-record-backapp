import { Model } from "mongoose";
import { TagModel } from "../models/tag.model";
import { ArticleModel } from "../models/article.model";
import { UpdateModel } from "../models/update.model";
import { slugify } from "./content.service";

// TypeScript no puede llamar a la unión de dos modelos distintos, así que los
// tratamos como colecciones genéricas al recorrerlas.
const CONTENT_MODELS: Model<any>[] = [ArticleModel as Model<any>, UpdateModel as Model<any>];

const PALETTE = ["#7B6CF6", "#C8392B", "#C9A84C", "#2094D2", "#57A773", "#FF6B7A", "#E0594A"];

/** Color estable a partir del slug: la misma etiqueta siempre sale igual. */
function colorFor(slug: string) {
  let hash = 0;
  for (let index = 0; index < slug.length; index += 1) {
    hash = (hash * 31 + slug.charCodeAt(index)) % 100000;
  }
  return PALETTE[hash % PALETTE.length];
}

export interface ResolvedTags {
  names: string[];
  slugs: string[];
}

/**
 * Convierte lo que llega del editor (nombres sueltos) en etiquetas canónicas.
 * Si el slug ya existe se reutiliza el nombre guardado; si no, se crea la
 * etiqueta. Así nunca acaban dos variantes de la misma palabra en la base.
 */
export async function resolveTags(
  input: unknown,
  author?: { userId?: string; email?: string },
): Promise<ResolvedTags> {
  if (!Array.isArray(input)) return { names: [], slugs: [] };

  const seen = new Set<string>();
  const wanted: { name: string; slug: string }[] = [];

  for (const raw of input) {
    const name = String(raw || "").trim();
    if (!name) continue;

    const slug = slugify(name);
    if (!slug || seen.has(slug)) continue;

    seen.add(slug);
    wanted.push({ name, slug });
  }

  if (!wanted.length) return { names: [], slugs: [] };

  const existing = await TagModel.find({ slug: { $in: wanted.map((tag) => tag.slug) } });
  const bySlug = new Map(existing.map((tag) => [tag.slug, tag]));

  const missing = wanted.filter((tag) => !bySlug.has(tag.slug));

  if (missing.length) {
    await TagModel.bulkWrite(
      missing.map((tag) => ({
        updateOne: {
          filter: { slug: tag.slug },
          update: {
            $setOnInsert: {
              name: tag.name,
              slug: tag.slug,
              color: colorFor(tag.slug),
              active: true,
              createdBy: author?.userId || "",
              createdByName: author?.email || "",
            },
          },
          upsert: true,
        },
      })),
    );

    const created = await TagModel.find({ slug: { $in: missing.map((tag) => tag.slug) } });
    created.forEach((tag) => bySlug.set(tag.slug, tag));
  }

  const slugs = wanted.map((tag) => tag.slug);

  return {
    names: slugs.map((slug) => bySlug.get(slug)?.name || slug),
    slugs,
  };
}

/** Recalcula cuántas piezas usan cada etiqueta. */
export async function recountTags(slugs: string[]) {
  const unique = Array.from(new Set(slugs.filter(Boolean)));
  if (!unique.length) return;

  await Promise.all(
    unique.map(async (slug) => {
      const [articles, updates] = await Promise.all([
        ArticleModel.countDocuments({ tagSlugs: slug }),
        UpdateModel.countDocuments({ tagSlugs: slug }),
      ]);

      await TagModel.updateOne({ slug }, { $set: { usageCount: articles + updates } });
    }),
  );
}

/** Recalcula todo el catálogo — útil tras una fusión o un borrado masivo. */
export async function recountAllTags() {
  const tags = await TagModel.find({}).select("slug");
  await recountTags(tags.map((tag) => tag.slug));
}

/**
 * Fusiona una etiqueta dentro de otra: reescribe el contenido que la usaba y
 * elimina la duplicada. Es la cura para las variantes que ya se colaron.
 */
export async function mergeTags(sourceId: string, targetId: string) {
  const [source, target] = await Promise.all([TagModel.findById(sourceId), TagModel.findById(targetId)]);
  if (!source || !target) return null;
  if (source.slug === target.slug) return target;

  for (const model of CONTENT_MODELS) {
    const affected = await model.find({ tagSlugs: source.slug });

    for (const doc of affected) {
      const item = doc.toObject() as { tags?: string[]; tagSlugs?: string[] };
      const slugs = new Set((item.tagSlugs || []).filter((slug) => slug !== source.slug));
      slugs.add(target.slug);

      const names = new Set((item.tags || []).filter((name) => slugify(name) !== source.slug));
      names.add(target.name);

      await model.updateOne({ _id: doc._id }, { $set: { tags: [...names], tagSlugs: [...slugs] } });
    }
  }

  await TagModel.deleteOne({ _id: source._id });
  await recountTags([target.slug]);

  return TagModel.findById(target._id);
}

/** Renombrar propaga el nombre nuevo al contenido que ya la usaba. */
export async function renameTag(id: string, name: string) {
  const tag = await TagModel.findById(id);
  if (!tag) return null;

  const slug = slugify(name);
  if (!slug) return tag;

  const clash = await TagModel.findOne({ slug, _id: { $ne: tag._id } });
  if (clash) return mergeTags(String(tag._id), String(clash._id));

  const previousSlug = tag.slug;
  tag.name = name.trim();
  tag.slug = slug;
  await tag.save();

  for (const model of CONTENT_MODELS) {
    const affected = await model.find({ tagSlugs: previousSlug });

    for (const doc of affected) {
      const item = doc.toObject() as { tags?: string[]; tagSlugs?: string[] };
      const names = (item.tags || []).map((entry) => (slugify(entry) === previousSlug ? tag.name : entry));
      const slugs = (item.tagSlugs || []).map((entry) => (entry === previousSlug ? slug : entry));

      await model.updateOne({ _id: doc._id }, { $set: { tags: names, tagSlugs: slugs } });
    }
  }

  return tag;
}

/** Quita la etiqueta del catálogo y del contenido que la usaba. */
export async function removeTag(id: string) {
  const tag = await TagModel.findById(id);
  if (!tag) return false;

  for (const model of CONTENT_MODELS) {
    await model.updateMany({ tagSlugs: tag.slug }, { $pull: { tagSlugs: tag.slug, tags: tag.name } });
  }

  await TagModel.deleteOne({ _id: tag._id });
  return true;
}

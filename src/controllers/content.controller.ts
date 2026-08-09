import { Response } from "express";
import { Model, isValidObjectId } from "mongoose";
import { AuthRequest } from "../types/AuthRequest";
import { CustomError } from "../errors/customError.error";
import { ReadEventModel } from "../models/readEvent.model";
import { CategoryModel } from "../models/category.model";
import {
  accentInsensitivePattern,
  blocksToHtml,
  blocksToText,
  countWords,
  randomToken,
  readingMinutes,
  slugify,
} from "../services/content.service";
import { proofread } from "../services/spellcheck.service";
import { recountTags, resolveTags } from "../services/tag.service";
import { notifyImmediatePublish, publishDueArticles, publishDueUpdates } from "../services/scheduler.service";
import { isAdminLike } from "../middlewares/role.middleware";

type AnyRecord = Record<string, unknown>;
type ContentKind = "article" | "update";

const COMMON_FIELDS = [
  "title",
  "summary",
  "blocks",
  "attachments",
  "aiAssets",
  "accentColor",
  "tags",
  "categoryId",
  "status",
  "scheduledFor",
];

const ARTICLE_FIELDS = [
  ...COMMON_FIELDS,
  "kicker",
  "key",
  "description",
  "observations",
  "photo",
  "typeId",
  "priority",
  "notifyOnPublish",
];
const UPDATE_FIELDS = [...COMMON_FIELDS, "articleId", "articleTitle", "notifyOnPublish"];

const STATUSES = ["draft", "review", "scheduled", "published", "archived"] as const;
type ContentStatus = (typeof STATUSES)[number];

function normalizeStatus(value: unknown): ContentStatus {
  return STATUSES.includes(value as ContentStatus) ? (value as ContentStatus) : "draft";
}

async function resolveCategoryName(categoryId: unknown) {
  if (typeof categoryId !== "string" || !categoryId || !isValidObjectId(categoryId)) return "";
  const category = await CategoryModel.findById(categoryId).select("name");
  return category?.name || "";
}

async function buildPayload(
  kind: ContentKind,
  body: AnyRecord,
  previous?: AnyRecord,
  author?: { userId?: string; email?: string },
) {
  const allowed = kind === "article" ? ARTICLE_FIELDS : UPDATE_FIELDS;
  const payload: AnyRecord = {};

  for (const field of allowed) {
    if (field in body) payload[field] = body[field];
  }

  const merged = { ...(previous || {}), ...payload };
  const blocks = Array.isArray(merged.blocks) ? (merged.blocks as AnyRecord[]) : [];

  payload.html = blocksToHtml(blocks);
  const plain = blocksToText(blocks);
  const words = countWords(plain);

  if (kind === "article") {
    payload.wordCount = words;
    payload.readingMinutes = readingMinutes(words);
    payload.slug = slugify(String(merged.title || ""));
  }

  payload.coverUrl = resolveCover(merged, blocks);

  payload.spellcheck = proofread([String(merged.title || ""), String(merged.summary || ""), plain].join("\n\n"));

  if ("categoryId" in payload) {
    payload.categoryName = await resolveCategoryName(payload.categoryId);
  }

  // Las etiquetas se normalizan contra el catálogo: nada de duplicados por
  // tildes o mayúsculas, y las nuevas quedan registradas en la base.
  if ("tags" in payload) {
    const resolved = await resolveTags(payload.tags, author);
    payload.tags = resolved.names;
    payload.tagSlugs = resolved.slugs;
  }

  const status = normalizeStatus(merged.status);
  payload.status = status;

  if (status === "scheduled") {
    const scheduledFor = new Date(String(merged.scheduledFor || ""));
    if (Number.isNaN(scheduledFor.getTime()) || scheduledFor <= new Date()) {
      throw new CustomError("Se requiere una fecha futura para programar la publicación", 400);
    }
    payload.scheduledFor = scheduledFor;
    payload.publishedAt = null;
  } else if (status === "published") {
    payload.publishedAt = previous?.publishedAt || new Date();
    payload.scheduledFor = null;
  } else {
    payload.scheduledFor = null;
    payload.publishedAt = status === "archived" ? previous?.publishedAt || null : null;
  }

  return payload;
}

/**
 * Rango de fechas para los listados. `from`/`to` llegan como ISO completo o
 * como `YYYY-MM-DD`; en ese segundo caso el `to` se estira al final del día
 * para que pedir el mismo día como desde y hasta incluya lo de ese día.
 *
 * Las fechas sueltas se tratan **en UTC de punta a punta**: `new Date("2026-08-07")`
 * ya se interpreta como medianoche UTC, así que cerrar el día con `setHours`
 * (que es local) dejaba el fin *antes* del inicio en husos negativos como el
 * de Ecuador, y el filtro de un solo día no devolvía nada.
 */
function dateRange(from: unknown, to: unknown) {
  const range: AnyRecord = {};

  const desde = from ? new Date(String(from)) : null;
  if (desde && !Number.isNaN(desde.getTime())) range.$gte = desde;

  const hasta = to ? new Date(String(to)) : null;
  if (hasta && !Number.isNaN(hasta.getTime())) {
    if (!String(to).includes("T")) hasta.setUTCHours(23, 59, 59, 999);
    range.$lte = hasta;
  }

  return Object.keys(range).length ? range : null;
}

/**
 * Portada de la pieza: la foto propia si la tiene, y si no la primera imagen
 * del cuerpo. Se guarda resuelta para que el feed del lector no tenga que
 * mandar los bloques —que son el 90% del peso— sólo para pintar una miniatura.
 */
function resolveCover(merged: AnyRecord, blocks: AnyRecord[]) {
  const photo = String(merged.photo || "");
  // Las base64 del sistema viejo no sirven como portada: pesan megas.
  if (photo && !photo.startsWith("data:")) return photo;

  for (const block of blocks) {
    if (block.kind === "media" && block.assetKind === "image" && block.assetUrl) {
      const url = String(block.assetUrl);
      if (!url.startsWith("data:")) return url;
    }

    const dentro = String(block.html || "").match(/<img\b[^>]*src=["'](https?:[^"']+)["']/i);
    if (dentro?.[1]) return dentro[1];
  }

  return "";
}

function canEdit(req: AuthRequest, doc: { authorId?: string }) {
  return isAdminLike(req.user!.roleId) || doc.authorId === req.user!.userId;
}

export function buildContentController(model: Model<any>, kind: ContentKind) {
  const runScheduler = kind === "article" ? publishDueArticles : publishDueUpdates;

  return {
    async list(req: AuthRequest, res: Response) {
      await runScheduler();

      const search = String(req.query.search || "").trim();
      const status = String(req.query.status || "").trim();
      const categoryId = String(req.query.categoryId || "").trim();
      const mine = String(req.query.mine || "") === "true";

      const filter: AnyRecord = {};
      if (search) {
        filter.$or = ["title", "summary", "tags"].map((field) => ({ [field]: { $regex: search, $options: "i" } }));
      }
      if (status && STATUSES.includes(status as ContentStatus)) filter.status = status;
      if (categoryId) filter.categoryId = categoryId;
      if (mine) filter.authorId = req.user!.userId;

      const tag = String(req.query.tag || "").trim();
      if (tag) filter.tagSlugs = tag;

      // En el panel se filtra por fecha de publicación; si aún no la tiene,
      // vale la de creación (borradores y programados).
      const rango = dateRange(req.query.from, req.query.to);
      if (rango) filter.$and = [{ $or: [{ publishedAt: rango }, { publishedAt: null, createdAt: rango }] }];

      const data = await model.find(filter).sort({ publishedAt: -1, updatedAt: -1 }).limit(300);
      res.json({ data, total: data.length });
    },

    /**
     * Feed del lector: paginado y filtrable. Cada vista del lector pide su
     * propia página, así que aquí no se devuelve nunca el catálogo entero.
     */
    async listPublic(req: AuthRequest, res: Response) {
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.min(48, Math.max(1, Number(req.query.limit) || 12));

      // Sin forzar: si ya pasó hace menos de 30 s no se repite. Antes eran dos
      // viajes extra a la base en cada carga de la lista.
      if (page === 1) await runScheduler(false);

      const categoryId = String(req.query.categoryId || "").trim();
      const tag = String(req.query.tag || "").trim();
      const search = String(req.query.search || "").trim();

      const filter: AnyRecord = { status: "published" };
      if (categoryId) filter.categoryId = categoryId;
      if (tag) filter.tagSlugs = tag;

      const rango = dateRange(req.query.from, req.query.to);
      if (rango) filter.publishedAt = rango;

      if (search) {
        const pattern = accentInsensitivePattern(search);
        filter.$or = ["title", "kicker", "summary", "tags"].map((field) => ({
          [field]: { $regex: pattern, $options: "i" },
        }));
      }

      // Sólo lo que pinta una tarjeta. Mandar `blocks` y `html` multiplicaba
      // por diez el peso de la respuesta para no mostrarlos.
      const projection =
        "title kicker summary coverUrl accentColor tags categoryId categoryName " +
        "status priority publishedAt readingMinutes wordCount authorName attachments.kind attachments.uid stats";

      const [data, total] = await Promise.all([
        model
          .find(filter)
          .sort({ publishedAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .select(projection),
        model.countDocuments(filter),
      ]);

      res.json({ data, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) });
    },

    async detail(req: AuthRequest, res: Response) {
      const { id } = req.params;
      if (!isValidObjectId(id)) throw new CustomError("Identificador inválido", 400);

      const doc = await model.findById(id);
      if (!doc) throw new CustomError("Contenido no encontrado", 404);

      res.json({ data: doc });
    },

    async create(req: AuthRequest, res: Response) {
      const payload = await buildPayload(kind, req.body as AnyRecord, undefined, req.user);
      if (!payload.title) throw new CustomError("El título es obligatorio", 400);

      const created = await model.create({
        ...payload,
        authorId: req.user!.userId,
        authorName: req.user!.email,
      });

      await recountTags((payload.tagSlugs as string[]) || []);

      // Si nace publicado, el aviso automático sale ya (lo programado lo hace el scheduler).
      if (created.status === "published") {
        await notifyImmediatePublish(created.toObject() as never, kind);
      }

      res.status(201).json({ data: created, message: "Contenido creado" });
    },

    async update(req: AuthRequest, res: Response) {
      const { id } = req.params;
      if (!isValidObjectId(id)) throw new CustomError("Identificador inválido", 400);

      const doc = await model.findById(id);
      if (!doc) throw new CustomError("Contenido no encontrado", 404);
      if (!canEdit(req, doc.toObject())) throw new CustomError("Solo puedes editar tu propio contenido", 403);

      const before = doc.toObject() as { tagSlugs?: string[]; status?: string };
      const payload = await buildPayload(kind, req.body as AnyRecord, doc.toObject(), req.user);
      const updated = await model.findByIdAndUpdate(id, payload, { new: true, runValidators: true });

      // Recontamos las de antes y las de ahora: las que se quitaron bajan.
      await recountTags([...(before.tagSlugs || []), ...((payload.tagSlugs as string[]) || [])]);

      // Solo al cruzar a publicado: reeditar algo ya publicado no vuelve a avisar.
      if (updated && before.status !== "published" && updated.status === "published") {
        await notifyImmediatePublish(updated.toObject() as never, kind);
      }

      res.json({ data: updated, message: "Contenido actualizado" });
    },

    async remove(req: AuthRequest, res: Response) {
      const { id } = req.params;
      if (!isValidObjectId(id)) throw new CustomError("Identificador inválido", 400);

      const doc = await model.findById(id);
      if (!doc) throw new CustomError("Contenido no encontrado", 404);
      if (!canEdit(req, doc.toObject())) throw new CustomError("Solo puedes eliminar tu propio contenido", 403);

      const removed = doc.toObject() as { tagSlugs?: string[] };
      await doc.deleteOne();
      await recountTags(removed.tagSlugs || []);

      res.json({ message: "Contenido eliminado" });
    },

    /** Creates or refreshes the tokenised link shared with clients over Signal. */
    async share(req: AuthRequest, res: Response) {
      const { id } = req.params;
      if (!isValidObjectId(id)) throw new CustomError("Identificador inválido", 400);

      const doc = await model.findById(id);
      if (!doc) throw new CustomError("Contenido no encontrado", 404);

      const { enabled = true, expiresInHours } = req.body as AnyRecord;
      const hours = Number(expiresInHours);
      const expiresAt = Number.isFinite(hours) && hours > 0 ? new Date(Date.now() + hours * 3600_000) : null;

      doc.share = {
        enabled: Boolean(enabled),
        token: enabled ? doc.share?.token || randomToken() : "",
        expiresAt,
        visits: doc.share?.visits || 0,
        lastVisitAt: doc.share?.lastVisitAt || null,
        channel: "signal",
      };

      await doc.save();

      const base = (process.env.PUBLIC_APP_URL || "").replace(/\/+$/, "");
      const path = `/s/${kind === "article" ? "r" : "a"}/${doc.share.token}`;

      res.json({
        data: {
          enabled: doc.share.enabled,
          token: doc.share.token,
          expiresAt: doc.share.expiresAt,
          url: doc.share.enabled ? `${base}${path}` : "",
          signalUrl: doc.share.enabled ? `https://signal.me/#p/${encodeURIComponent(`${base}${path}`)}` : "",
        },
        message: enabled ? "Enlace generado" : "Enlace desactivado",
      });
    },

    /** Registers a read and updates aggregate stats. */
    async registerRead(req: AuthRequest, res: Response) {
      const { id } = req.params;
      if (!isValidObjectId(id)) throw new CustomError("Identificador inválido", 400);

      const doc = await model.findById(id);
      if (!doc) throw new CustomError("Contenido no encontrado", 404);

      const seconds = Math.max(0, Math.min(7200, Number((req.body as AnyRecord).seconds) || 0));
      const completed = Boolean((req.body as AnyRecord).completed);
      const userId = req.user?.userId || "";

      const previous = userId
        ? await ReadEventModel.exists({ targetType: kind, targetId: id, userId })
        : null;

      await ReadEventModel.create({
        targetType: kind,
        targetId: id,
        targetTitle: doc.title,
        categoryId: doc.categoryId || "",
        categoryName: doc.categoryName || "",
        userId,
        userName: req.user?.email || "",
        userEmail: req.user?.email || "",
        roleId: req.user?.roleId || 0,
        channel: req.user ? "app" : "share",
        seconds,
        completed,
        ip: req.ip || "",
        userAgent: String(req.headers["user-agent"] || ""),
      });

      const views = (doc.stats?.views || 0) + 1;
      const totalSeconds = (doc.stats?.avgSeconds || 0) * (views - 1) + seconds;

      doc.stats = {
        views,
        uniqueViews: (doc.stats?.uniqueViews || 0) + (previous ? 0 : 1),
        shareVisits: doc.stats?.shareVisits || 0,
        avgSeconds: Math.round(totalSeconds / views),
        lastReadAt: new Date(),
      };

      await doc.save();

      res.json({ data: doc.stats, message: "Lectura registrada" });
    },
  };
}

/** Public reader for a Signal share token. */
export function buildShareReader(model: Model<any>, kind: ContentKind) {
  return async function readShared(req: AuthRequest, res: Response) {
    const token = String(req.params.token || "");
    if (!token) throw new CustomError("Enlace inválido", 400);

    const doc = await model.findOne({ "share.token": token, "share.enabled": true });
    if (!doc) throw new CustomError("Enlace no disponible", 404);

    if (doc.share?.expiresAt && new Date(doc.share.expiresAt) < new Date()) {
      throw new CustomError("El enlace expiró", 410);
    }

    doc.share.visits = (doc.share.visits || 0) + 1;
    doc.share.lastVisitAt = new Date();
    doc.stats = { ...(doc.stats?.toObject?.() || doc.stats || {}), shareVisits: (doc.stats?.shareVisits || 0) + 1 };
    await doc.save();

    await ReadEventModel.create({
      targetType: kind,
      targetId: String(doc._id),
      targetTitle: doc.title,
      categoryId: doc.categoryId || "",
      categoryName: doc.categoryName || "",
      channel: "share",
      ip: req.ip || "",
      userAgent: String(req.headers["user-agent"] || ""),
    });

    const data = doc.toObject();
    delete data.authorId;
    delete data.spellcheck;
    delete data.observations;
    delete data.share;

    res.json({ data });
  };
}

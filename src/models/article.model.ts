import { Schema, model, InferSchemaType } from "mongoose";
import {
  aiAssetSchema,
  attachmentSchema,
  blockSchema,
  CONTENT_STATUSES,
  shareSchema,
  spellcheckSchema,
  statsSchema,
} from "./shared.schema";

/**
 * Reportaje. The long-form editorial unit of Off The Record.
 */
const articleSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    kicker: { type: String, trim: true, default: "" },
    slug: { type: String, trim: true, default: "", index: true },
    key: { type: String, trim: true, default: "" },
    summary: { type: String, trim: true, default: "" },
    description: { type: String, trim: true, default: "" },
    html: { type: String, default: "" },
    blocks: { type: [blockSchema], default: [] },
    attachments: { type: [attachmentSchema], default: [] },
    aiAssets: { type: [aiAssetSchema], default: [] },
    observations: { type: String, trim: true, default: "" },
    photo: { type: String, default: "" },
    accentColor: { type: String, default: "#C8392B" },
    tags: { type: [String], default: [] },
    tagSlugs: { type: [String], default: [], index: true },
    typeId: { type: Number, default: 1 },
    categoryId: { type: String, default: "", index: true },
    categoryName: { type: String, default: "" },
    status: { type: String, enum: CONTENT_STATUSES, default: "draft", index: true },
    priority: { type: String, enum: ["low", "normal", "high", "breaking"], default: "normal" },
    scheduledFor: { type: Date, default: null, index: true },
    /** Id en el sistema viejo (otradmin): hace la migración repetible. */
    legacyId: { type: String, default: "", index: true },
    /** Portada ya resuelta: evita mandar los bloques enteros para pintar una tarjeta. */
    coverUrl: { type: String, default: "" },
    /** Si está marcado, publicar dispara la notificación automática. */
    notifyOnPublish: { type: Boolean, default: true },
    publishedAt: { type: Date, default: null, index: true },
    readingMinutes: { type: Number, default: 1 },
    wordCount: { type: Number, default: 0 },
    share: { type: shareSchema, default: () => ({}) },
    stats: { type: statsSchema, default: () => ({}) },
    spellcheck: { type: spellcheckSchema, default: () => ({}) },
    userId: { type: String, default: "" },
    authorId: { type: String, required: true, index: true },
    authorName: { type: String, default: "" },
  },
  { timestamps: true, versionKey: false },
);

articleSchema.index({ title: "text", summary: "text", description: "text" });

export type ArticleDocument = InferSchemaType<typeof articleSchema>;

export const ArticleModel = model("Article", articleSchema);

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
 * Actualización. Short editorial follow-up, optionally attached to a reportaje
 * and always schedulable.
 */
const updateSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    summary: { type: String, trim: true, default: "" },
    html: { type: String, default: "" },
    blocks: { type: [blockSchema], default: [] },
    attachments: { type: [attachmentSchema], default: [] },
    aiAssets: { type: [aiAssetSchema], default: [] },
    accentColor: { type: String, default: "#2094D2" },
    tags: { type: [String], default: [] },
    tagSlugs: { type: [String], default: [], index: true },
    articleId: { type: String, default: "", index: true },
    /** Id en otradmin: hace repetible la migración. */
    legacyId: { type: String, default: "", index: true },
    /** Portada ya resuelta: evita mandar los bloques enteros para pintar una tarjeta. */
    coverUrl: { type: String, default: "" },
    articleTitle: { type: String, default: "" },
    categoryId: { type: String, default: "", index: true },
    categoryName: { type: String, default: "" },
    status: { type: String, enum: CONTENT_STATUSES, default: "draft", index: true },
    scheduledFor: { type: Date, default: null, index: true },
    publishedAt: { type: Date, default: null, index: true },
    notifyOnPublish: { type: Boolean, default: false },
    share: { type: shareSchema, default: () => ({}) },
    stats: { type: statsSchema, default: () => ({}) },
    spellcheck: { type: spellcheckSchema, default: () => ({}) },
    authorId: { type: String, required: true, index: true },
    authorName: { type: String, default: "" },
  },
  { timestamps: true, versionKey: false },
);

updateSchema.index({ title: "text", summary: "text" });

export type UpdateDocument = InferSchemaType<typeof updateSchema>;

export const UpdateModel = model("Update", updateSchema);

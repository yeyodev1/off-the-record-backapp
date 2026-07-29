import { Schema, model, InferSchemaType } from "mongoose";

const articleSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    key: { type: String, trim: true, default: "" },
    summary: { type: String, trim: true, default: "" },
    description: { type: String, trim: true, default: "" },
    status: { type: String, enum: ["draft", "scheduled", "published"], default: "draft", index: true },
    scheduledFor: { type: Date, default: null, index: true },
    publishedAt: { type: Date, default: null, index: true },
    observations: { type: String, trim: true, default: "" },
    photo: { type: String, default: "" },
    typeId: { type: Number, default: 1 },
    userId: { type: String, default: "" },
    authorId: { type: String, required: true, index: true },
    authorName: { type: String, default: "" },
  },
  { timestamps: true, versionKey: false },
);

export type ArticleDocument = InferSchemaType<typeof articleSchema>;

export const ArticleModel = model("Article", articleSchema);

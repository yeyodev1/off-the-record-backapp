import { Schema, model, InferSchemaType } from "mongoose";

const articleSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    key: { type: String, trim: true, default: "" },
    summary: { type: String, trim: true, default: "" },
    description: { type: String, trim: true, default: "" },
    status: { type: Boolean, default: true },
    observations: { type: String, trim: true, default: "" },
    photo: { type: String, default: "" },
    typeId: { type: Number, required: true },
    userId: { type: Number, required: true },
  },
  { timestamps: true, versionKey: false },
);

export type ArticleDocument = InferSchemaType<typeof articleSchema>;

export const ArticleModel = model("Article", articleSchema);

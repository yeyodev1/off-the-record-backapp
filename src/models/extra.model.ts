import { Schema, model, InferSchemaType } from "mongoose";

const extraSchema = new Schema(
  {
    deep: { type: Boolean, default: false },
    deepdate: { type: Date, default: null },
    information: { type: Boolean, default: false },
    interest: { type: Boolean, default: false },
    reunion: { type: Boolean, default: false },
    userId: { type: Number, required: true },
    articleId: { type: Number, default: null },
  },
  { timestamps: true, versionKey: false },
);

export type ExtraDocument = InferSchemaType<typeof extraSchema>;

export const ExtraModel = model("Extra", extraSchema);

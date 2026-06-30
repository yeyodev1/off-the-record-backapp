import { Schema, model, InferSchemaType } from "mongoose";

const logSchema = new Schema(
  {
    userId: { type: Number, required: true },
    articleId: { type: Number, required: true },
  },
  { timestamps: true, versionKey: false },
);

export type LogDocument = InferSchemaType<typeof logSchema>;

export const LogModel = model("Log", logSchema);

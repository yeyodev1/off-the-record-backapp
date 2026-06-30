import { Schema, model, InferSchemaType } from "mongoose";

const logExclusiveSchema = new Schema(
  {
    userId: { type: Number, required: true },
    exclusiveId: { type: Number, required: true },
  },
  { timestamps: true, versionKey: false },
);

export type LogExclusiveDocument = InferSchemaType<typeof logExclusiveSchema>;

export const LogExclusiveModel = model("LogExclusive", logExclusiveSchema);

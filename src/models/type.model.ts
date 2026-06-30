import { Schema, model, InferSchemaType } from "mongoose";

const typeSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
  },
  { timestamps: true, versionKey: false },
);

export type TypeDocument = InferSchemaType<typeof typeSchema>;

export const TypeModel = model("Type", typeSchema);

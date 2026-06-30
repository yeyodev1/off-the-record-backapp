import { Schema, model, InferSchemaType } from "mongoose";

const uploadSchema = new Schema(
  {
    url: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    userId: { type: Number, required: true },
  },
  { timestamps: true, versionKey: false },
);

export type UploadDocument = InferSchemaType<typeof uploadSchema>;

export const UploadModel = model("Upload", uploadSchema);

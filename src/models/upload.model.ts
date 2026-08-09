import { Schema, model, InferSchemaType } from "mongoose";

const uploadSchema = new Schema(
  {
    url: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    kind: { type: String, enum: ["image", "video", "audio", "document"], default: "image", index: true },
    mime: { type: String, default: "" },
    bytes: { type: Number, default: 0 },
    provider: { type: String, default: "cloudinary" },
    publicId: { type: String, default: "" },
    source: { type: String, enum: ["upload", "ai", "external"], default: "upload" },
    userId: { type: String, required: true, index: true },
  },
  { timestamps: true, versionKey: false },
);

export type UploadDocument = InferSchemaType<typeof uploadSchema>;

export const UploadModel = model("Upload", uploadSchema);

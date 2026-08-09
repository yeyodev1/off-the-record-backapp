import { Schema, model, InferSchemaType } from "mongoose";

/**
 * "Administración de usuarios por categorías y archivos":
 * documents attached to a specific user record.
 */
const userArchiveSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true },
    url: { type: String, required: true },
    kind: { type: String, enum: ["image", "video", "audio", "document"], default: "document" },
    mime: { type: String, default: "" },
    bytes: { type: Number, default: 0 },
    note: { type: String, default: "" },
    uploadedBy: { type: String, default: "" },
    uploadedByName: { type: String, default: "" },
  },
  { timestamps: true, versionKey: false },
);

export type UserArchiveDocument = InferSchemaType<typeof userArchiveSchema>;

export const UserArchiveModel = model("UserArchive", userArchiveSchema);

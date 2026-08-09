import { Schema, model, InferSchemaType } from "mongoose";

/**
 * One row per read of a reportaje or actualización.
 * This is the raw material for "lo más leído por secciones".
 */
const readEventSchema = new Schema(
  {
    targetType: { type: String, enum: ["article", "update"], required: true, index: true },
    targetId: { type: String, required: true, index: true },
    targetTitle: { type: String, default: "" },
    categoryId: { type: String, default: "", index: true },
    categoryName: { type: String, default: "" },
    userId: { type: String, default: "", index: true },
    userName: { type: String, default: "" },
    userEmail: { type: String, default: "" },
    roleId: { type: Number, default: 0 },
    channel: { type: String, enum: ["app", "share", "api"], default: "app", index: true },
    seconds: { type: Number, default: 0 },
    completed: { type: Boolean, default: false },
    ip: { type: String, default: "" },
    userAgent: { type: String, default: "" },
    readAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true, versionKey: false },
);

readEventSchema.index({ targetType: 1, targetId: 1, userId: 1 });
readEventSchema.index({ readAt: -1 });

export type ReadEventDocument = InferSchemaType<typeof readEventSchema>;

export const ReadEventModel = model("ReadEvent", readEventSchema);

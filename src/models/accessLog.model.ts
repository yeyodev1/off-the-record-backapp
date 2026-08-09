import { Schema, model, InferSchemaType } from "mongoose";

/**
 * Login / logout / failed-attempt trail. Requirement: "registrar el ingreso".
 */
const accessLogSchema = new Schema(
  {
    userId: { type: String, default: "", index: true },
    userName: { type: String, default: "" },
    email: { type: String, default: "", index: true },
    roleId: { type: Number, default: 0 },
    action: { type: String, enum: ["login", "logout", "failed", "refresh"], default: "login", index: true },
    ip: { type: String, default: "" },
    userAgent: { type: String, default: "" },
    reason: { type: String, default: "" },
    at: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true, versionKey: false },
);

accessLogSchema.index({ at: -1 });

export type AccessLogDocument = InferSchemaType<typeof accessLogSchema>;

export const AccessLogModel = model("AccessLog", accessLogSchema);

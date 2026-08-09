import { Schema, model, InferSchemaType } from "mongoose";

/**
 * Personalised notifications. Supports immediate or scheduled delivery and
 * an audience expressed as everybody, a role, a user category or explicit users.
 */
const notificationSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    /** Canal principal; se conserva por compatibilidad con lo ya guardado. */
    channel: { type: String, enum: ["app", "signal", "telegram", "email"], default: "app", index: true },
    /** Una notificación puede salir por varios canales a la vez. */
    channels: { type: [String], default: ["app"] },
    /** Quién la originó: la escribió alguien o la disparó una regla. */
    trigger: { type: String, enum: ["manual", "publish", "report"], default: "manual", index: true },
    audience: {
      type: String,
      enum: ["all", "role", "category", "users"],
      default: "all",
    },
    roleId: { type: Number, default: null },
    categoryId: { type: String, default: "" },
    userIds: { type: [String], default: [] },
    targetType: { type: String, enum: ["article", "update", "none"], default: "none" },
    targetId: { type: String, default: "" },
    link: { type: String, default: "" },
    status: { type: String, enum: ["draft", "scheduled", "sent", "failed"], default: "draft", index: true },
    scheduledFor: { type: Date, default: null, index: true },
    sentAt: { type: Date, default: null },
    deliveredCount: { type: Number, default: 0 },
    /** Resultado real del envío externo, para poder diagnosticar. */
    delivery: {
      attempted: { type: Number, default: 0 },
      succeeded: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
      errors: { type: [String], default: [] },
    },
    readBy: { type: [String], default: [] },
    error: { type: String, default: "" },
    createdBy: { type: String, default: "" },
    createdByName: { type: String, default: "" },
  },
  { timestamps: true, versionKey: false },
);

export type NotificationDocument = InferSchemaType<typeof notificationSchema>;

export const NotificationModel = model("Notification", notificationSchema);

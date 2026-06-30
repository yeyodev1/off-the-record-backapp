import { Schema, model, InferSchemaType } from "mongoose";

const notificationSchema = new Schema(
  {
    message: { type: String, required: true, trim: true },
    userId: { type: Number, required: true },
    articleId: { type: Number, default: null },
    users: [{ type: Number }],
  },
  { timestamps: true, versionKey: false },
);

export type NotificationDocument = InferSchemaType<typeof notificationSchema>;

export const NotificationModel = model("Notification", notificationSchema);

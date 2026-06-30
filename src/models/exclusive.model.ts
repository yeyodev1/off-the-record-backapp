import { Schema, model, InferSchemaType } from "mongoose";

const exclusiveSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    summary: { type: String, trim: true, default: "" },
    description: { type: String, trim: true, default: "" },
    status: { type: Boolean, default: true },
    date: { type: Date, default: Date.now },
    typeId: { type: Number, required: true },
    userId: { type: Number, required: true },
    users: [{ type: Number }],
  },
  { timestamps: true, versionKey: false },
);

export type ExclusiveDocument = InferSchemaType<typeof exclusiveSchema>;

export const ExclusiveModel = model("Exclusive", exclusiveSchema);

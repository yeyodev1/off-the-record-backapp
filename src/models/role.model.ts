import { Schema, model, InferSchemaType } from "mongoose";

const roleSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
  },
  { timestamps: true, versionKey: false },
);

export type RoleDocument = InferSchemaType<typeof roleSchema>;

export const RoleModel = model("Role", roleSchema);

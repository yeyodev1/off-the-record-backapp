import { Schema, model, InferSchemaType } from "mongoose";

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    lastname: { type: String, trim: true, default: "" },
    ci: { type: String, trim: true, default: "" },
    email: { type: String, required: true, trim: true, lowercase: true, unique: true },
    password: { type: String, required: true, select: false },
    active: { type: Boolean, default: true },
    changepass: { type: Boolean, default: false },
    photo: { type: String, default: "" },
    register: { type: Date, default: Date.now },
    phone: { type: String, default: "" },
    premium: { type: Boolean, default: false },
    roleId: { type: Number, required: true, default: 3 },
    tokenVersion: { type: Number, default: 0 },
  },
  { timestamps: true, versionKey: false },
);

export type UserDocument = InferSchemaType<typeof userSchema>;

export const UserModel = model("User", userSchema);

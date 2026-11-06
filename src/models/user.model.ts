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
    /** Número en formato +593… al que escribe el puente de Signal. */
    signalHandle: { type: String, default: "" },
    /** Lo entrega el bot cuando el usuario le escribe /start. */
    telegramChatId: { type: String, default: "", index: true },
    /** Enlace de un solo uso t.me/<bot>?start=<token> para conectar el chat sin copiar ids. */
    telegramLinkToken: { type: String, default: "", select: false, index: true },
    telegramLinkExpires: { type: Date, default: null, select: false },
    /** El lector puede apagar las noticias por correo. */
    emailNotifications: { type: Boolean, default: true },
    /** Un correo adicional al que también le llegan las noticias. */
    notifyEmail: { type: String, trim: true, lowercase: true, default: "" },
    /** Id en otradmin: hace repetible la migración del padrón. */
    legacyId: { type: String, default: "", index: true },
    organization: { type: String, default: "" },
    position: { type: String, default: "" },
    notes: { type: String, default: "" },
    premium: { type: Boolean, default: false },
    roleId: { type: Number, required: true, default: 3 },
    categoryIds: { type: [String], default: [], index: true },
    categoryNames: { type: [String], default: [] },
    lastLoginAt: { type: Date, default: null },
    loginCount: { type: Number, default: 0 },
    readCount: { type: Number, default: 0 },
    tokenVersion: { type: Number, default: 0 },
  },
  { timestamps: true, versionKey: false },
);

export type UserDocument = InferSchemaType<typeof userSchema>;

export const UserModel = model("User", userSchema);

import { Schema, model, InferSchemaType } from "mongoose";

/**
 * Ajustes de la sala de redacción. Es un documento único (`key: "global"`):
 * aquí viven las integraciones de mensajería y las reglas de las
 * notificaciones automáticas.
 */
const settingsSchema = new Schema(
  {
    key: { type: String, default: "global", unique: true, index: true },

    telegram: {
      enabled: { type: Boolean, default: false },
      /** Token del bot de @BotFather. Nunca se devuelve al panel en claro. */
      botToken: { type: String, default: "" },
      /** Canal o grupo al que además se envía todo, si se quiere. */
      broadcastChatId: { type: String, default: "" },
    },

    signal: {
      enabled: { type: Boolean, default: false },
      /**
       * Signal no tiene API pública de envío: se habla con un puente
       * `signal-cli-rest-api` que la redacción aloja, por ejemplo
       * http://localhost:8080
       */
      apiUrl: { type: String, default: "" },
      /** Número emisor ya registrado en el puente, en formato +593… */
      number: { type: String, default: "" },
      /** Grupo de Signal opcional al que se difunde todo. */
      groupId: { type: String, default: "" },
    },

    /** Qué dispara una notificación sin que nadie la escriba. */
    auto: {
      onArticlePublish: { type: Boolean, default: true },
      onUpdatePublish: { type: Boolean, default: true },
      onDailyReport: { type: Boolean, default: false },
      /** Canales por los que salen las automáticas. */
      channels: { type: [String], default: ["app"] },
    },

    updatedBy: { type: String, default: "" },
    updatedByName: { type: String, default: "" },
  },
  { timestamps: true, versionKey: false },
);

export type SettingsDocument = InferSchemaType<typeof settingsSchema>;

export const SettingsModel = model("Settings", settingsSchema);

/** Devuelve los ajustes creando el documento único la primera vez. */
export async function getSettings() {
  const existing = await SettingsModel.findOne({ key: "global" });
  if (existing) return existing;

  return SettingsModel.create({ key: "global" });
}

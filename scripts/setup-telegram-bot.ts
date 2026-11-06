/**
 * Deja el bot de noticias listo en producción:
 *
 *   TELEGRAM_BOT_TOKEN="<token de @BotFather>" bun scripts/setup-telegram-bot.ts
 *
 * Guarda el token en los ajustes, enciende el canal, suma Telegram a los
 * avisos automáticos, registra el webhook y pone nombre, descripción y
 * comandos del bot. Es repetible.
 */
import "dotenv/config";
import mongoose from "mongoose";
import { SettingsModel, getSettings } from "../src/models/settings.model";
import { registerTelegramWebhook, telegramApi } from "../src/services/messaging.service";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const API_URL = (process.env.API_URL || "https://off-the-record-backapp.vercel.app").replace(/\/+$/, "");

async function main() {
  if (!/^\d+:[\w-]{30,}$/.test(TOKEN)) throw new Error("Falta TELEGRAM_BOT_TOKEN o no tiene forma de token");

  await mongoose.connect(process.env.DB_URI as string);

  const settings = await getSettings();
  const channels = settings.auto?.channels?.length ? settings.auto.channels : ["app"];
  await SettingsModel.updateOne(
    { key: "global" },
    {
      $set: {
        "telegram.enabled": true,
        "telegram.botToken": TOKEN,
        "auto.channels": [...new Set([...channels, "telegram"])],
      },
    },
  );

  const me = await telegramApi("getMe");
  console.log(`Bot: @${me.username}`);

  await registerTelegramWebhook(`${API_URL}/api/telegram/webhook`);
  await telegramApi("setMyName", { name: "Off The Record" });
  await telegramApi("setMyShortDescription", {
    short_description: "Las noticias de Off The Record, en tu Telegram. Solo suscriptores.",
  });
  await telegramApi("setMyDescription", {
    description:
      "Recibe cada reportaje y actualización de Off The Record en cuanto se publica.\n\n" +
      "Para conectarte: entra a app.otr.com.ec → Ajustes → «Conectar Telegram».",
  });
  await telegramApi("setMyCommands", {
    commands: [
      { command: "start", description: "Ver si estás conectado" },
      { command: "stop", description: "Dejar de recibir noticias aquí" },
    ],
  });

  const info = await telegramApi("getWebhookInfo");
  const after = await getSettings();
  console.log(`Webhook: ${info.url} · pendientes ${info.pending_update_count}${info.last_error_message ? ` · último error: ${info.last_error_message}` : ""}`);
  console.log(`Avisos automáticos por: ${after.auto?.channels?.join(", ")}`);

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error("Falló:", error.message);
  await mongoose.disconnect();
  process.exit(1);
});

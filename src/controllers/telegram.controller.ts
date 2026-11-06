import { randomBytes, timingSafeEqual } from "crypto";
import { Request, Response } from "express";
import { AuthRequest } from "../types/AuthRequest";
import { CustomError } from "../errors/customError.error";
import { getSettings } from "../models/settings.model";
import { UserModel } from "../models/user.model";
import { sendTelegram, telegramApi } from "../services/messaging.service";

/**
 * Bot de noticias por Telegram.
 *
 * El lector pulsa «Conectar Telegram» en Ajustes → recibe un enlace
 * t.me/<bot>?start=<token> de un solo uso → Telegram abre el bot y le manda
 * «/start <token>» → el webhook guarda el chat en su cuenta. Desde ahí le
 * llegan las notificaciones que salgan por el canal Telegram.
 */

const LINK_TTL_MS = 30 * 60_000;
const settingsUrl = () => `${(process.env.PUBLIC_APP_URL || "https://app.otr.com.ec").replace(/\/+$/, "")}/lector/ajustes`;

export async function createTelegramLink(req: AuthRequest, res: Response) {
  const settings = await getSettings();
  if (!settings.telegram?.enabled || !settings.telegram.botToken) {
    throw new CustomError("Las noticias por Telegram todavía no están activas", 503);
  }

  let username = "";
  try {
    username = String((await telegramApi("getMe")).username || "");
  } catch {
    // se cae al error de abajo
  }
  if (!username) throw new CustomError("El bot de Telegram no responde. Inténtalo en unos minutos.", 502);

  const token = randomBytes(16).toString("hex");
  await UserModel.updateOne(
    { _id: req.user!.userId },
    { $set: { telegramLinkToken: token, telegramLinkExpires: new Date(Date.now() + LINK_TTL_MS) } },
  );

  res.json({ data: { url: `https://t.me/${username}?start=${token}` } });
}

function sameSecret(got: string, expected: string) {
  return got.length === expected.length && timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

/** Lo que Telegram nos reenvía cuando alguien le escribe al bot. */
export async function telegramWebhook(req: Request, res: Response) {
  const settings = await getSettings();
  const secret = settings.telegram?.webhookSecret || "";
  const got = String(req.get("x-telegram-bot-api-secret-token") || "");

  if (!secret || !sameSecret(got, secret)) {
    throw new CustomError("No autorizado", 401);
  }

  const message = (req.body as { message?: { text?: string; chat?: { id?: number; type?: string } } })?.message;
  const chatId = message?.chat?.id;

  // Solo chats privados: el bot no atiende grupos.
  if (chatId && message?.chat?.type === "private") {
    try {
      await handleMessage(String(chatId), String(message.text || "").trim());
    } catch (error) {
      console.error("Webhook de Telegram:", (error as Error).message);
    }
  }

  // Siempre 200: si no, Telegram reintenta el mismo mensaje una y otra vez.
  res.json({ ok: true });
}

async function handleMessage(chatId: string, text: string) {
  const [command = "", arg = ""] = text.split(/\s+/);

  if (command === "/start" && arg) {
    const user = await UserModel.findOne({
      telegramLinkToken: arg,
      telegramLinkExpires: { $gt: new Date() },
    }).select("_id name");

    if (!user) {
      await sendTelegram(chatId, `Este enlace ya venció o ya se usó. Genera uno nuevo en ${settingsUrl()}`);
      return;
    }

    // Un chat, una cuenta: si otra cuenta lo tenía, deja de recibir aquí.
    await UserModel.updateMany({ telegramChatId: chatId, _id: { $ne: user._id } }, { $set: { telegramChatId: "" } });
    await UserModel.updateOne(
      { _id: user._id },
      { $set: { telegramChatId: chatId, telegramLinkToken: "", telegramLinkExpires: null } },
    );

    await sendTelegram(
      chatId,
      `Listo, ${user.name}. Desde ahora recibirás aquí las noticias de Off The Record.\n\nEscribe /stop si quieres dejar de recibirlas.`,
    );
    return;
  }

  if (command === "/stop") {
    const result = await UserModel.updateMany({ telegramChatId: chatId }, { $set: { telegramChatId: "" } });
    await sendTelegram(
      chatId,
      result.modifiedCount
        ? `Listo, ya no recibirás noticias por aquí. Puedes volver a activarlas en ${settingsUrl()}`
        : "Este chat no estaba conectado a ninguna cuenta.",
    );
    return;
  }

  const linked = await UserModel.exists({ telegramChatId: chatId });
  await sendTelegram(
    chatId,
    linked
      ? "Estás conectado: aquí te llegarán las noticias de Off The Record. Escribe /stop para dejar de recibirlas."
      : `Este bot es solo para suscriptores de Off The Record. Para conectarlo, entra a ${settingsUrl()} y pulsa «Conectar Telegram».`,
  );
}

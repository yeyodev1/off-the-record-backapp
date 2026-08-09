import { Response } from "express";
import { AuthRequest } from "../types/AuthRequest";
import { CustomError } from "../errors/customError.error";
import { SettingsModel, getSettings } from "../models/settings.model";
import { UserModel } from "../models/user.model";
import { checkSignal, checkTelegram, sendSignal, sendTelegram } from "../services/messaging.service";

type AnyRecord = Record<string, unknown>;

const CHANNELS = ["app", "telegram", "signal"];

/**
 * El token del bot nunca vuelve al panel: se manda si está puesto y sus
 * últimos cuatro caracteres, suficiente para reconocerlo sin exponerlo.
 */
function present(settings: Awaited<ReturnType<typeof getSettings>>) {
  const token = settings.telegram?.botToken || "";

  return {
    telegram: {
      enabled: Boolean(settings.telegram?.enabled),
      tokenSet: Boolean(token),
      tokenHint: token ? `···${token.slice(-4)}` : "",
      broadcastChatId: settings.telegram?.broadcastChatId || "",
    },
    signal: {
      enabled: Boolean(settings.signal?.enabled),
      apiUrl: settings.signal?.apiUrl || "",
      number: settings.signal?.number || "",
      groupId: settings.signal?.groupId || "",
    },
    auto: {
      onArticlePublish: settings.auto?.onArticlePublish !== false,
      onUpdatePublish: settings.auto?.onUpdatePublish !== false,
      onDailyReport: Boolean(settings.auto?.onDailyReport),
      channels: settings.auto?.channels?.length ? settings.auto.channels : ["app"],
    },
    updatedAt: settings.updatedAt,
    updatedByName: settings.updatedByName || "",
  };
}

export async function readSettings(_req: AuthRequest, res: Response) {
  const settings = await getSettings();
  res.json({ data: present(settings) });
}

export async function saveSettings(req: AuthRequest, res: Response) {
  await getSettings(); // garantiza que el documento único exista

  const body = req.body as AnyRecord;
  const telegram = (body.telegram || {}) as AnyRecord;
  const signal = (body.signal || {}) as AnyRecord;
  const auto = (body.auto || {}) as AnyRecord;

  // Rutas con punto: solo se toca lo que llegó, nunca se pisa el resto.
  const $set: AnyRecord = {
    updatedBy: req.user!.userId,
    updatedByName: req.user!.email,
  };

  if ("enabled" in telegram) $set["telegram.enabled"] = Boolean(telegram.enabled);
  if ("broadcastChatId" in telegram) {
    $set["telegram.broadcastChatId"] = String(telegram.broadcastChatId || "").trim();
  }
  // Token vacío significa "no lo cambies": el panel nunca recibió el real.
  if (typeof telegram.botToken === "string" && telegram.botToken.trim()) {
    $set["telegram.botToken"] = telegram.botToken.trim();
  }

  if ("enabled" in signal) $set["signal.enabled"] = Boolean(signal.enabled);
  if ("apiUrl" in signal) $set["signal.apiUrl"] = String(signal.apiUrl || "").trim();
  if ("number" in signal) $set["signal.number"] = String(signal.number || "").trim();
  if ("groupId" in signal) $set["signal.groupId"] = String(signal.groupId || "").trim();

  if ("onArticlePublish" in auto) $set["auto.onArticlePublish"] = Boolean(auto.onArticlePublish);
  if ("onUpdatePublish" in auto) $set["auto.onUpdatePublish"] = Boolean(auto.onUpdatePublish);
  if ("onDailyReport" in auto) $set["auto.onDailyReport"] = Boolean(auto.onDailyReport);
  if (Array.isArray(auto.channels)) {
    const picked = auto.channels.map(String).filter((item) => CHANNELS.includes(item));
    $set["auto.channels"] = picked.length ? picked : ["app"];
  }

  const updated = await SettingsModel.findOneAndUpdate({ key: "global" }, { $set }, { new: true });
  if (!updated) throw new CustomError("No se pudieron guardar los ajustes", 500);

  res.json({ data: present(updated), message: "Integraciones guardadas" });
}

/** Estado en vivo de los dos puentes, para el semáforo del panel. */
export async function channelStatus(_req: AuthRequest, res: Response) {
  const [telegram, signal] = await Promise.all([checkTelegram(), checkSignal()]);
  res.json({ data: { telegram, signal } });
}

/** Envía un mensaje de prueba al destino indicado o a la propia cuenta. */
export async function testChannel(req: AuthRequest, res: Response) {
  const channel = String(req.params.channel || "");
  if (channel !== "telegram" && channel !== "signal") {
    throw new CustomError("Canal desconocido", 400);
  }

  const body = req.body as AnyRecord;
  let to = String(body.to || "").trim();

  if (!to) {
    const me = await UserModel.findById(req.user!.userId).select("signalHandle telegramChatId");
    to = String((channel === "telegram" ? me?.telegramChatId : me?.signalHandle) || "");
  }

  if (!to) {
    throw new CustomError(
      channel === "telegram"
        ? "Indica un chat de Telegram, o guarda el tuyo en tu ficha de usuario"
        : "Indica un número de Signal, o guarda el tuyo en tu ficha de usuario",
      400,
    );
  }

  const text = "Off The Record · prueba de integración. Si lees esto, el canal funciona.";
  const result = channel === "telegram" ? await sendTelegram(to, text) : await sendSignal(to, text);

  if (!result.ok) throw new CustomError(result.error || "No se pudo enviar", 502);

  res.json({ data: result, message: `Mensaje de prueba enviado a ${to}` });
}

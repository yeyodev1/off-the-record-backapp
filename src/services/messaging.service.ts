import { randomBytes } from "crypto";
import { SettingsModel, getSettings } from "../models/settings.model";

/**
 * Envío por Telegram y Signal.
 *
 * Telegram tiene API oficial de bots y basta un token.
 *
 * Signal **no tiene API pública de envío**: signal.org/docs son las
 * especificaciones del protocolo, no un servicio. La única vía real es un
 * puente propio — `signal-cli` expuesto por `signal-cli-rest-api` — con un
 * número ya registrado. Por eso la configuración pide una URL: la del puente
 * que aloje la redacción, no un servicio de Signal.
 */

const TIMEOUT_MS = 15000;

export type Channel = "telegram" | "signal" | "email";

export interface DeliveryResult {
  channel: Channel;
  to: string;
  ok: boolean;
  error?: string;
}

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const text = await response.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    payload = { raw: text.slice(0, 200) };
  }

  if (!response.ok) {
    const detail =
      (payload.description as string) || (payload.error as string) || (payload.raw as string) || "";
    throw new Error(`${response.status}${detail ? ` · ${detail}` : ""}`);
  }

  return payload;
}

/* ------------------------------------------------------------------ */
/* Telegram — API oficial de bots                                      */
/* ------------------------------------------------------------------ */

export async function sendTelegram(chatId: string, text: string): Promise<DeliveryResult> {
  const result: DeliveryResult = { channel: "telegram", to: chatId, ok: false };

  try {
    const settings = await getSettings();
    if (!settings.telegram?.enabled) throw new Error("Telegram está desactivado");
    if (!settings.telegram.botToken) throw new Error("Falta el token del bot");
    if (!chatId) throw new Error("El destinatario no tiene chat de Telegram");

    // Texto plano: un «&» o «<» en un titular rompía el envío con parse_mode HTML.
    await postJson(`https://api.telegram.org/bot${settings.telegram.botToken}/sendMessage`, {
      chat_id: chatId,
      text,
    });

    result.ok = true;
  } catch (error) {
    result.error = error instanceof Error ? error.message : "Falló el envío";
  }

  return result;
}

/** Cualquier método de la API de bots (getMe, setWebhook…). Lanza si Telegram dice que no. */
export async function telegramApi(method: string, body: unknown = {}) {
  const settings = await getSettings();
  if (!settings.telegram?.botToken) throw new Error("Falta el token del bot");

  const payload = await postJson(`https://api.telegram.org/bot${settings.telegram.botToken}/${method}`, body);
  return payload.result as Record<string, unknown>;
}

/**
 * Le dice a Telegram a dónde mandar lo que los lectores escriben al bot.
 * Idempotente: el secreto se crea una vez y se reutiliza.
 */
export async function registerTelegramWebhook(url: string) {
  const settings = await getSettings();
  let secret = settings.telegram?.webhookSecret || "";
  if (!secret) {
    secret = randomBytes(24).toString("hex");
    await SettingsModel.updateOne({ key: "global" }, { $set: { "telegram.webhookSecret": secret } });
  }

  await telegramApi("setWebhook", {
    url,
    secret_token: secret,
    allowed_updates: ["message"],
  });
}

/* ------------------------------------------------------------------ */
/* Signal — puente signal-cli-rest-api                                 */
/* ------------------------------------------------------------------ */

export async function sendSignal(recipient: string, text: string): Promise<DeliveryResult> {
  const result: DeliveryResult = { channel: "signal", to: recipient, ok: false };

  try {
    const settings = await getSettings();
    if (!settings.signal?.enabled) throw new Error("Signal está desactivado");
    if (!settings.signal.apiUrl) throw new Error("Falta la URL del puente signal-cli");
    if (!settings.signal.number) throw new Error("Falta el número emisor registrado");
    if (!recipient) throw new Error("El destinatario no tiene número de Signal");

    const base = settings.signal.apiUrl.replace(/\/+$/, "");

    await postJson(`${base}/v2/send`, {
      message: text,
      number: settings.signal.number,
      recipients: [recipient],
    });

    result.ok = true;
  } catch (error) {
    result.error = error instanceof Error ? error.message : "Falló el envío";
  }

  return result;
}

/* ------------------------------------------------------------------ */
/* Comprobaciones desde el panel                                       */
/* ------------------------------------------------------------------ */

export interface ChannelStatus {
  configured: boolean;
  reachable: boolean;
  detail: string;
}

/** Verifica el token contra `getMe`: confirma que el bot existe y es nuestro. */
export async function checkTelegram(): Promise<ChannelStatus> {
  const settings = await getSettings();

  if (!settings.telegram?.botToken) {
    return { configured: false, reachable: false, detail: "Sin token de bot" };
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${settings.telegram.botToken}/getMe`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await response.json()) as { ok?: boolean; result?: { username?: string }; description?: string };

    if (!body.ok) {
      return { configured: true, reachable: false, detail: body.description || "Token rechazado" };
    }

    return { configured: true, reachable: true, detail: `Conectado como @${body.result?.username || "bot"}` };
  } catch (error) {
    return {
      configured: true,
      reachable: false,
      detail: error instanceof Error ? error.message : "No respondió",
    };
  }
}

/** Pregunta al puente por sus cuentas registradas. */
export async function checkSignal(): Promise<ChannelStatus> {
  const settings = await getSettings();

  if (!settings.signal?.apiUrl) {
    return { configured: false, reachable: false, detail: "Sin URL del puente" };
  }

  const base = settings.signal.apiUrl.replace(/\/+$/, "");

  try {
    const response = await fetch(`${base}/v1/accounts`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) {
      return { configured: true, reachable: false, detail: `El puente respondió ${response.status}` };
    }

    const accounts = (await response.json()) as string[] | Record<string, unknown>;
    const list = Array.isArray(accounts) ? accounts : [];

    if (settings.signal.number && list.length && !list.includes(settings.signal.number)) {
      return {
        configured: true,
        reachable: false,
        detail: `El puente no tiene registrado ${settings.signal.number}. Registrados: ${list.join(", ")}`,
      };
    }

    return {
      configured: true,
      reachable: true,
      detail: list.length ? `Puente activo · ${list.join(", ")}` : "Puente activo, sin cuentas registradas",
    };
  } catch (error) {
    return {
      configured: true,
      reachable: false,
      detail: error instanceof Error ? error.message : "No respondió",
    };
  }
}

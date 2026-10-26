import type { ChannelStatus, DeliveryResult } from "./messaging.service";

/**
 * Correo por Resend (resend.com), sobre el dominio verificado otr.com.ec.
 *
 * Se habla con la API REST directamente: son dos llamadas y no compensa otra
 * dependencia. Nada de aquí lanza hacia fuera — igual que Telegram y Signal,
 * cada envío devuelve su resultado y quien llama decide qué hacer.
 *
 *   RESEND_API_KEY   clave de Resend (sin ella el canal queda apagado)
 *   EMAIL_FROM       remitente, p. ej. "Off The Record <notificaciones@otr.com.ec>"
 *   ALERT_EMAILS     destinatarios de las alertas técnicas, separados por coma
 */

const API = "https://api.resend.com";
const TIMEOUT_MS = 15000;
/** Resend acepta como mucho 100 correos por llamada en lote. */
const BATCH_SIZE = 100;

const apiKey = () => process.env.RESEND_API_KEY || "";
const from = () => process.env.EMAIL_FROM || "Off The Record <notificaciones@otr.com.ec>";
const appUrl = () => (process.env.PUBLIC_APP_URL || "").replace(/\/+$/, "");

export function isEmailConfigured() {
  return Boolean(apiKey());
}

export function alertRecipients() {
  return (process.env.ALERT_EMAILS || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(isValidEmail);
}

/** Descarta direcciones mal formadas y los autores provisionales de la migración. */
export function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !email.endsWith(".local");
}

export function escapeHtml(text: string) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

const espera = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Una llamada a Resend con un reintento si el fallo es pasajero
 * (límite de ritmo o caída del servicio). Un 4xx no se repite: no va a cambiar.
 */
async function post(path: string, body: unknown) {
  let ultimo = "";

  for (let intento = 1; intento <= 3; intento++) {
    try {
      const response = await fetch(API + path, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey()}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      const text = await response.text();
      let payload: Record<string, unknown> = {};
      try {
        payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      } catch {
        payload = { message: text.slice(0, 200) };
      }

      if (response.ok) return payload;

      ultimo = `${response.status}${payload.message ? ` · ${payload.message}` : ""}`;
      if (response.status !== 429 && response.status < 500) break;
    } catch (error) {
      ultimo = (error as Error).message;
    }

    await espera(1000 * intento);
  }

  throw new Error(ultimo || "Resend no respondió");
}

export async function sendEmail(message: EmailMessage): Promise<DeliveryResult> {
  const result: DeliveryResult = { channel: "email", to: message.to, ok: false };

  try {
    if (!isEmailConfigured()) throw new Error("Falta RESEND_API_KEY");
    if (!isValidEmail(message.to)) throw new Error("Dirección no válida");

    await post("/emails", { from: from(), ...message });
    result.ok = true;
  } catch (error) {
    result.error = (error as Error).message;
  }

  return result;
}

/**
 * Un correo por persona —nunca una lista en «Para»: los lectores no deben
 * verse entre sí—, agrupados de 100 en 100 para no hacer una llamada por cada uno.
 */
export async function sendEmailBatch(messages: EmailMessage[]): Promise<DeliveryResult[]> {
  const results: DeliveryResult[] = [];
  const validos = messages.filter((message) => isValidEmail(message.to));

  for (const message of messages) {
    if (!isValidEmail(message.to)) {
      results.push({ channel: "email", to: message.to, ok: false, error: "Dirección no válida" });
    }
  }

  if (!validos.length) return results;

  if (!isEmailConfigured()) {
    return results.concat(validos.map((message) => ({ channel: "email" as const, to: message.to, ok: false, error: "Falta RESEND_API_KEY" })));
  }

  for (let i = 0; i < validos.length; i += BATCH_SIZE) {
    const lote = validos.slice(i, i + BATCH_SIZE);
    try {
      await post("/emails/batch", lote.map((message) => ({ from: from(), ...message })));
      results.push(...lote.map((message) => ({ channel: "email" as const, to: message.to, ok: true })));
    } catch (error) {
      const motivo = (error as Error).message;
      results.push(...lote.map((message) => ({ channel: "email" as const, to: message.to, ok: false, error: motivo })));
    }
  }

  return results;
}

/** Semáforo del panel: comprueba la clave y que el dominio siga verificado. */
export async function checkEmail(): Promise<ChannelStatus> {
  if (!isEmailConfigured()) return { configured: false, reachable: false, detail: "Falta RESEND_API_KEY" };

  const remitente = from();
  const dominio = (remitente.match(/@([^>\s]+)/)?.[1] || "").toLowerCase();

  try {
    const response = await fetch(`${API}/domains`, {
      headers: { authorization: `Bearer ${apiKey()}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return { configured: true, reachable: false, detail: `Resend respondió ${response.status}` };

    const payload = (await response.json()) as { data?: { name: string; status: string }[] };
    const registro = (payload.data || []).find((item) => item.name === dominio);
    if (!registro) return { configured: true, reachable: false, detail: `El dominio ${dominio} no está en Resend` };
    if (registro.status !== "verified") {
      return { configured: true, reachable: false, detail: `El dominio ${dominio} está ${registro.status}` };
    }

    return { configured: true, reachable: true, detail: `Envía como ${remitente}` };
  } catch (error) {
    return { configured: true, reachable: false, detail: (error as Error).message };
  }
}

/* ------------------------------------------------------------------ */
/* Plantilla                                                           */
/* ------------------------------------------------------------------ */

interface Layout {
  eyebrow: string;
  title: string;
  body: string;
  ctaLabel?: string;
  ctaUrl?: string;
  footer?: string;
}

/** HTML de correo: tablas y estilos en línea, que es lo que entienden los clientes. */
export function renderEmail({ eyebrow, title, body, ctaLabel, ctaUrl, footer }: Layout) {
  const parrafos = String(body || "")
    .split(/\n{2,}/)
    .map((item) => `<p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:#2b2b2b">${escapeHtml(item).replace(/\n/g, "<br>")}</p>`)
    .join("");

  const boton =
    ctaLabel && ctaUrl
      ? `<p style="margin:24px 0 0"><a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:#C8392B;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:6px">${escapeHtml(ctaLabel)}</a></p>`
      : "";

  const html = `<!doctype html><html lang="es"><body style="margin:0;padding:0;background:#f3f1ec">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f1ec;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:10px;overflow:hidden;font-family:Georgia,'Times New Roman',serif">
<tr><td style="background:#0b1424;padding:18px 28px;color:#ffffff;font-size:18px;font-weight:bold;letter-spacing:.3px">Off The Record</td></tr>
<tr><td style="padding:28px">
<p style="margin:0 0 8px;font-family:Arial,sans-serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#C8392B">${escapeHtml(eyebrow)}</p>
<h1 style="margin:0 0 18px;font-size:24px;line-height:1.3;color:#0b1424">${escapeHtml(title)}</h1>
${parrafos}${boton}
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #ece8df;font-family:Arial,sans-serif;font-size:12px;color:#8a857b">${escapeHtml(footer || "Recibes este correo por tu suscripción a Off The Record. Contenido confidencial: no lo reenvíes.")}</td></tr>
</table></td></tr></table></body></html>`;

  const text = [eyebrow.toUpperCase(), title, body, ctaUrl ? `${ctaLabel}: ${ctaUrl}` : "", footer || ""]
    .filter(Boolean)
    .join("\n\n");

  return { html, text };
}

/** Enlace a la pieza dentro de la app del lector. */
export function pieceUrl(targetType?: string, targetId?: string) {
  const base = appUrl();
  if (!base) return "";
  if (targetType === "article" && targetId) return `${base}/lector/reportajes/${targetId}`;
  if (targetType === "update" && targetId) return `${base}/lector/actualizaciones/${targetId}`;
  return `${base}/lector`;
}

/* ------------------------------------------------------------------ */
/* Alertas técnicas                                                    */
/* ------------------------------------------------------------------ */

/** Misma alerta, como mucho una vez cada 15 min: un fallo en bucle no debe inundar el buzón. */
const ULTIMA_ALERTA = new Map<string, number>();
const SILENCIO_MS = 15 * 60_000;

export async function sendAlert(subject: string, detail: string) {
  const destinatarios = alertRecipients();
  if (!isEmailConfigured() || !destinatarios.length) return;

  const clave = subject.slice(0, 160);
  const ahora = Date.now();
  if (ahora - (ULTIMA_ALERTA.get(clave) || 0) < SILENCIO_MS) return;
  ULTIMA_ALERTA.set(clave, ahora);

  const entorno = process.env.VERCEL_ENV || process.env.NODE_ENV || "local";
  const { html, text } = renderEmail({
    eyebrow: `Alerta · ${entorno}`,
    title: subject,
    body: `${detail}\n\n${new Date().toISOString()}`,
    footer: "Alerta automática del backend de Off The Record. Se agrupan: la misma no se repite en 15 minutos.",
  });

  const resultados = await Promise.all(
    destinatarios.map((to) => sendEmail({ to, subject: `[OTR] ${subject}`.slice(0, 180), html, text })),
  );

  for (const resultado of resultados) {
    if (!resultado.ok) console.error(`No se pudo enviar la alerta a ${resultado.to}: ${resultado.error}`);
  }
}

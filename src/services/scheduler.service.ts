import { ArticleModel } from "../models/article.model";
import { UpdateModel } from "../models/update.model";
import { NotificationModel } from "../models/notification.model";
import { UserModel } from "../models/user.model";
import { getSettings } from "../models/settings.model";
import { ensureScheduledReports } from "./report.service";
import { syncDueIndicators } from "./indicatorSync.service";
import { sendSignal, sendTelegram, type DeliveryResult } from "./messaging.service";
import { invalidateFacets } from "../controllers/reader.controller";

/** Devuelve los usuarios concretos, no un número: hay que escribirles. */
async function resolveRecipients(notification: {
  audience: string;
  roleId?: number | null;
  categoryId?: string;
  userIds?: string[];
}) {
  const filter: Record<string, unknown> = { active: true };

  if (notification.audience === "users") {
    filter._id = { $in: notification.userIds || [] };
  }

  if (notification.audience === "role" && typeof notification.roleId === "number") {
    filter.roleId = notification.roleId;
  }

  if (notification.audience === "category" && notification.categoryId) {
    filter.categoryIds = notification.categoryId;
  }

  return UserModel.find(filter).select("name lastname email signalHandle telegramChatId");
}

interface PublishedPiece {
  _id: unknown;
  title: string;
  summary?: string;
  notifyOnPublish?: boolean;
  authorId?: string;
  authorName?: string;
}

/**
 * Crea las notificaciones automáticas de lo que se acaba de publicar.
 * La pieza manda: si el redactor desmarcó el aviso, no se notifica aunque la
 * regla global esté encendida.
 */
async function queueAutoNotifications(
  pieces: PublishedPiece[],
  kind: "article" | "update",
  now: Date,
) {
  const settings = await getSettings();
  const ruleOn = kind === "article" ? settings.auto?.onArticlePublish : settings.auto?.onUpdatePublish;
  if (!ruleOn) return;

  const notifiable = pieces.filter((item) => item.notifyOnPublish);
  if (!notifiable.length) return;

  const channels = settings.auto?.channels?.length ? settings.auto.channels : ["app"];
  const label = kind === "article" ? "Nuevo reportaje" : "Nueva actualización";

  await NotificationModel.insertMany(
    notifiable.map((item) => ({
      title: label,
      message: item.title,
      channel: channels[0],
      channels,
      audience: "all",
      targetType: kind,
      targetId: String(item._id),
      trigger: "publish",
      status: "scheduled",
      scheduledFor: now,
      createdBy: item.authorId || "",
      createdByName: item.authorName || "Automático",
    })),
  );
}

/**
 * El planificador ya corre solo cada 60 s. Llamarlo además en cada carga del
 * feed añadía dos viajes a la base por petición, que con Atlas remoto son
 * cientos de milisegundos. Se limita a una vez cada medio minuto.
 */
const ULTIMA_PASADA = new Map<string, number>();
const CADENCIA_MS = 30_000;

function tocaRevisar(clave: string) {
  const ahora = Date.now();
  if (ahora - (ULTIMA_PASADA.get(clave) || 0) < CADENCIA_MS) return false;
  ULTIMA_PASADA.set(clave, ahora);
  return true;
}

export async function publishDueArticles(forzar = true) {
  if (!forzar && !tocaRevisar("article")) return;

  const now = new Date();
  const due = await ArticleModel.find({ status: "scheduled", scheduledFor: { $lte: now } });
  if (!due.length) return;

  await ArticleModel.updateMany(
    { _id: { $in: due.map((item) => item._id) } },
    { $set: { status: "published", publishedAt: now } },
  );

  invalidateFacets();
  await queueAutoNotifications(due.map((item) => item.toObject() as PublishedPiece), "article", now);
}

export async function publishDueUpdates(forzar = true) {
  if (!forzar && !tocaRevisar("update")) return;

  const now = new Date();
  const due = await UpdateModel.find({ status: "scheduled", scheduledFor: { $lte: now } });
  if (!due.length) return;

  await UpdateModel.updateMany(
    { _id: { $in: due.map((item) => item._id) } },
    { $set: { status: "published", publishedAt: now } },
  );

  invalidateFacets();
  await queueAutoNotifications(due.map((item) => item.toObject() as PublishedPiece), "update", now);
}

/** Publicación inmediata (sin programar): la llama el controlador de contenido. */
export async function notifyImmediatePublish(piece: PublishedPiece, kind: "article" | "update") {
  invalidateFacets();
  await queueAutoNotifications([piece], kind, new Date());
}

/** El texto que sale por Telegram o Signal, con el enlace si lo hay. */
function composeMessage(notification: { title: string; message: string; link?: string }) {
  const parts = [notification.title, notification.message].filter(Boolean);
  if (notification.link) parts.push(notification.link);
  return parts.join("\n\n");
}

export async function dispatchDueNotifications() {
  const now = new Date();
  const due = await NotificationModel.find({ status: "scheduled", scheduledFor: { $lte: now } });
  if (!due.length) return;

  const settings = await getSettings();

  for (const notification of due) {
    const recipients = await resolveRecipients(notification.toObject());
    const channels = notification.channels?.length ? notification.channels : [notification.channel || "app"];
    const text = composeMessage(notification.toObject());

    const results: DeliveryResult[] = [];

    // "app" no se envía: la campana lee la notificación de la base.
    if (channels.includes("telegram") && settings.telegram?.enabled) {
      for (const user of recipients) {
        if (!user.telegramChatId) continue;
        results.push(await sendTelegram(user.telegramChatId, text));
      }
      if (settings.telegram.broadcastChatId) {
        results.push(await sendTelegram(settings.telegram.broadcastChatId, text));
      }
    }

    if (channels.includes("signal") && settings.signal?.enabled) {
      for (const user of recipients) {
        if (!user.signalHandle) continue;
        results.push(await sendSignal(user.signalHandle, text));
      }
    }

    const failed = results.filter((result) => !result.ok);

    notification.status = "sent";
    notification.sentAt = now;
    notification.deliveredCount = recipients.length;
    notification.delivery = {
      attempted: results.length,
      succeeded: results.length - failed.length,
      failed: failed.length,
      // Se guardan solo los primeros errores: basta para diagnosticar.
      errors: failed.slice(0, 10).map((result) => `${result.channel} ${result.to}: ${result.error}`),
    };
    notification.error = failed.length ? `${failed.length} envíos fallaron` : "";

    await notification.save();
  }
}

export async function runScheduler() {
  await publishDueArticles();
  await publishDueUpdates();
  await dispatchDueNotifications();

  // Las fuentes externas pueden caerse; que no arrastren al resto.
  try {
    await syncDueIndicators();
  } catch (error) {
    console.error("No se pudieron sincronizar los indicadores", error);
  }

  // Los reportes se generan solos; un fallo de IA no debe frenar el resto.
  try {
    await ensureScheduledReports();
  } catch (error) {
    console.error("No se pudieron generar los reportes automáticos", error);
  }
}

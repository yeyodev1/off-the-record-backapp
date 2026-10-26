import { Response } from "express";
import { isValidObjectId } from "mongoose";
import { AuthRequest } from "../types/AuthRequest";
import { CustomError } from "../errors/customError.error";
import { NotificationModel } from "../models/notification.model";
import { UserModel } from "../models/user.model";
import { isAdminLike } from "../middlewares/role.middleware";
import { deliverNotification } from "../services/scheduler.service";

type AnyRecord = Record<string, unknown>;

const EDITABLE = [
  "title",
  "message",
  "channel",
  "audience",
  "roleId",
  "categoryId",
  "userIds",
  "targetType",
  "targetId",
  "link",
  "scheduledFor",
];

const CHANNELS = ["app", "telegram", "signal", "email"];

function buildPayload(body: AnyRecord) {
  const payload: AnyRecord = {};
  for (const field of EDITABLE) {
    if (field in body) payload[field] = body[field];
  }

  // El formulario elige un canal; el despacho lee la lista. Sin derivarla, el
  // valor por defecto (["app"]) dejaba fuera el correo y Signal.
  if (Array.isArray(body.channels)) {
    const picked = body.channels.map(String).filter((item) => CHANNELS.includes(item));
    const channels = picked.length ? picked : ["app"];
    payload.channels = channels;
    payload.channel = channels[0];
  } else if ("channel" in payload) {
    const channel = CHANNELS.includes(String(payload.channel)) ? String(payload.channel) : "app";
    payload.channel = channel;
    payload.channels = channel === "app" ? ["app"] : ["app", channel];
  }

  if (payload.roleId !== undefined && payload.roleId !== null) {
    payload.roleId = Number(payload.roleId) || null;
  }

  if (payload.scheduledFor) {
    const date = new Date(String(payload.scheduledFor));
    if (Number.isNaN(date.getTime())) throw new CustomError("Fecha de envío inválida", 400);
    payload.scheduledFor = date;
  }

  return payload;
}

export async function listNotifications(req: AuthRequest, res: Response) {
  const status = String(req.query.status || "").trim();
  const filter: AnyRecord = {};
  if (["draft", "scheduled", "sent", "failed"].includes(status)) filter.status = status;

  const data = await NotificationModel.find(filter).sort({ createdAt: -1 }).limit(200);
  res.json({ data });
}

/** Resume el envío para el aviso del panel: cuántos llegaron y cuántos no. */
function deliveryMessage(notification: { delivery?: { attempted?: number; failed?: number } | null }) {
  const attempted = notification.delivery?.attempted || 0;
  const failed = notification.delivery?.failed || 0;
  if (!attempted) return "Notificación enviada";
  if (!failed) return `Notificación enviada · ${attempted} envíos externos`;
  return `Notificación enviada · ${attempted - failed} de ${attempted} envíos externos llegaron`;
}

export async function createNotification(req: AuthRequest, res: Response) {
  const body = req.body as AnyRecord;
  if (!body.title || !body.message) throw new CustomError("Título y mensaje son obligatorios", 400);

  const payload = buildPayload(body);
  const sendNow = body.sendNow === true || !payload.scheduledFor;

  const created = await NotificationModel.create({
    ...payload,
    status: sendNow ? "sent" : "scheduled",
    sentAt: sendNow ? new Date() : null,
    deliveredCount: 0,
    createdBy: req.user!.userId,
    createdByName: req.user!.email,
  });

  // Antes solo se marcaba como enviada: la campana la veía, pero no salía
  // por Telegram, Signal ni correo.
  const data = sendNow ? await deliverNotification(created) : created;

  res.status(201).json({ data, message: sendNow ? deliveryMessage(data) : "Notificación programada" });
}

export async function updateNotification(req: AuthRequest, res: Response) {
  const { id } = req.params;
  if (!isValidObjectId(id)) throw new CustomError("Identificador inválido", 400);

  const notification = await NotificationModel.findById(id);
  if (!notification) throw new CustomError("Notificación no encontrada", 404);
  if (notification.status === "sent") throw new CustomError("No se puede editar una notificación enviada", 400);

  const payload = buildPayload(req.body as AnyRecord);
  const updated = await NotificationModel.findByIdAndUpdate(id, payload, { new: true, runValidators: true });

  res.json({ data: updated, message: "Notificación actualizada" });
}

export async function sendNotification(req: AuthRequest, res: Response) {
  const { id } = req.params;
  if (!isValidObjectId(id)) throw new CustomError("Identificador inválido", 400);

  const notification = await NotificationModel.findById(id);
  if (!notification) throw new CustomError("Notificación no encontrada", 404);

  if (notification.status === "sent") throw new CustomError("Esta notificación ya se envió", 400);

  const data = await deliverNotification(notification);
  res.json({ data, message: deliveryMessage(data) });
}

export async function deleteNotification(req: AuthRequest, res: Response) {
  const { id } = req.params;
  if (!isValidObjectId(id)) throw new CustomError("Identificador inválido", 400);

  const removed = await NotificationModel.findByIdAndDelete(id);
  if (!removed) throw new CustomError("Notificación no encontrada", 404);

  res.json({ message: "Notificación eliminada" });
}

/** Notifications visible to the signed-in reader. */
export async function myNotifications(req: AuthRequest, res: Response) {
  const user = await UserModel.findById(req.user!.userId).select("roleId categoryIds");
  if (!user) throw new CustomError("Usuario no encontrado", 404);

  const data = await NotificationModel.find({
    status: "sent",
    $or: [
      { audience: "all" },
      { audience: "role", roleId: user.roleId },
      { audience: "category", categoryId: { $in: user.categoryIds } },
      { audience: "users", userIds: req.user!.userId },
    ],
  })
    .sort({ sentAt: -1 })
    .limit(50);

  res.json({ data });
}

export async function markNotificationRead(req: AuthRequest, res: Response) {
  const { id } = req.params;
  if (!isValidObjectId(id)) throw new CustomError("Identificador inválido", 400);

  await NotificationModel.updateOne({ _id: id }, { $addToSet: { readBy: req.user!.userId } });
  res.json({ message: "Notificación marcada como leída" });
}

export function canManageNotifications(req: AuthRequest) {
  return isAdminLike(req.user?.roleId);
}

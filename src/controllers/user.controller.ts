import { Response } from "express";
import { isValidObjectId } from "mongoose";
import { AuthRequest } from "../types/AuthRequest";
import { CustomError } from "../errors/customError.error";
import { UserModel } from "../models/user.model";
import { UserArchiveModel } from "../models/userArchive.model";
import { CategoryModel } from "../models/category.model";
import { ReadEventModel } from "../models/readEvent.model";
import { AccessLogModel } from "../models/accessLog.model";
import { hashPassword } from "../utils/password";

type AnyRecord = Record<string, unknown>;

const EDITABLE = [
  "name",
  "lastname",
  "ci",
  "phone",
  "signalHandle",
  "telegramChatId",
  "organization",
  "position",
  "notes",
  "photo",
  "premium",
  "active",
  "roleId",
  "categoryIds",
];

function sanitize(user: AnyRecord) {
  const { password, tokenVersion, ...safe } = user;
  return safe;
}

async function resolveCategoryNames(ids: unknown) {
  if (!Array.isArray(ids) || !ids.length) return [];
  const valid = ids.filter((id) => typeof id === "string" && isValidObjectId(id));
  if (!valid.length) return [];
  const categories = await CategoryModel.find({ _id: { $in: valid } }).select("name");
  return categories.map((category) => category.name);
}

export async function listUsers(req: AuthRequest, res: Response) {
  const search = String(req.query.search || "").trim();
  const roleId = Number(req.query.roleId);
  const categoryId = String(req.query.categoryId || "").trim();

  const filter: AnyRecord = {};
  if (search) {
    filter.$or = ["name", "lastname", "email", "organization", "ci"].map((field) => ({
      [field]: { $regex: search, $options: "i" },
    }));
  }
  if (Number.isFinite(roleId) && roleId > 0) filter.roleId = roleId;
  if (categoryId) filter.categoryIds = categoryId;

  const users = await UserModel.find(filter).sort({ createdAt: -1 }).limit(500);
  res.json({ data: users.map((user) => sanitize(user.toObject())), total: users.length });
}

export async function getUser(req: AuthRequest, res: Response) {
  const { id } = req.params;
  if (!isValidObjectId(id)) throw new CustomError("Identificador inválido", 400);

  const user = await UserModel.findById(id);
  if (!user) throw new CustomError("Usuario no encontrado", 404);

  const [archives, reads, logins] = await Promise.all([
    UserArchiveModel.find({ userId: id }).sort({ createdAt: -1 }),
    ReadEventModel.find({ userId: id }).sort({ readAt: -1 }).limit(30),
    AccessLogModel.find({ userId: id }).sort({ at: -1 }).limit(30),
  ]);

  res.json({ data: { user: sanitize(user.toObject()), archives, reads, logins } });
}

export async function createUser(req: AuthRequest, res: Response) {
  const body = req.body as AnyRecord;
  const { name, email, password } = body;

  if (!name || !email || !password) {
    throw new CustomError("Nombre, email y contraseña son obligatorios", 400);
  }

  const normalizedEmail = String(email).toLowerCase();
  const existing = await UserModel.findOne({ email: normalizedEmail });
  if (existing) throw new CustomError("El email ya está registrado", 409);

  const payload: AnyRecord = { email: normalizedEmail, password: await hashPassword(String(password)) };
  for (const field of EDITABLE) {
    if (field in body) payload[field] = body[field];
  }
  payload.categoryNames = await resolveCategoryNames(payload.categoryIds);
  payload.roleId = Number(payload.roleId) || 2;

  const user = await UserModel.create(payload);
  res.status(201).json({ data: sanitize(user.toObject()), message: "Usuario creado" });
}

export async function updateUser(req: AuthRequest, res: Response) {
  const { id } = req.params;
  if (!isValidObjectId(id)) throw new CustomError("Identificador inválido", 400);

  const body = req.body as AnyRecord;
  const payload: AnyRecord = {};

  for (const field of EDITABLE) {
    if (field in body) payload[field] = body[field];
  }

  if ("categoryIds" in payload) {
    payload.categoryNames = await resolveCategoryNames(payload.categoryIds);
  }

  if (typeof body.password === "string" && body.password.length >= 8) {
    payload.password = await hashPassword(body.password);
    payload.changepass = false;
    await UserModel.updateOne({ _id: id }, { $inc: { tokenVersion: 1 } });
  }

  const updated = await UserModel.findByIdAndUpdate(id, payload, { new: true, runValidators: true });
  if (!updated) throw new CustomError("Usuario no encontrado", 404);

  res.json({ data: sanitize(updated.toObject()), message: "Usuario actualizado" });
}

export async function deleteUser(req: AuthRequest, res: Response) {
  const { id } = req.params;
  if (!isValidObjectId(id)) throw new CustomError("Identificador inválido", 400);

  if (id === req.user!.userId) {
    throw new CustomError("No puedes eliminar tu propia cuenta", 400);
  }

  const user = await UserModel.findByIdAndDelete(id);
  if (!user) throw new CustomError("Usuario no encontrado", 404);

  await UserArchiveModel.deleteMany({ userId: id });
  res.json({ message: "Usuario eliminado" });
}

/* ------------------------------------------------------------------ */
/* Archivos del usuario                                                */
/* ------------------------------------------------------------------ */

export async function listArchives(req: AuthRequest, res: Response) {
  const { id } = req.params;
  if (!isValidObjectId(id)) throw new CustomError("Identificador inválido", 400);

  const data = await UserArchiveModel.find({ userId: id }).sort({ createdAt: -1 });
  res.json({ data });
}

export async function addArchive(req: AuthRequest, res: Response) {
  const { id } = req.params;
  if (!isValidObjectId(id)) throw new CustomError("Identificador inválido", 400);

  const { name, url, kind, mime, bytes, note } = req.body as AnyRecord;
  if (!name || !url) throw new CustomError("Nombre y URL del archivo son obligatorios", 400);

  const archive = await UserArchiveModel.create({
    userId: id,
    name,
    url,
    kind: kind || "document",
    mime: mime || "",
    bytes: Number(bytes) || 0,
    note: note || "",
    uploadedBy: req.user!.userId,
    uploadedByName: req.user!.email,
  });

  res.status(201).json({ data: archive, message: "Archivo agregado" });
}

export async function removeArchive(req: AuthRequest, res: Response) {
  const { archiveId } = req.params;
  if (!isValidObjectId(archiveId)) throw new CustomError("Identificador inválido", 400);

  const removed = await UserArchiveModel.findByIdAndDelete(archiveId);
  if (!removed) throw new CustomError("Archivo no encontrado", 404);

  res.json({ message: "Archivo eliminado" });
}

export async function me(req: AuthRequest, res: Response) {
  const user = await UserModel.findById(req.user!.userId);
  if (!user) throw new CustomError("Usuario no encontrado", 404);

  res.json({ data: sanitize(user.toObject()) });
}

/** Lo que cualquiera puede cambiar de su propia ficha. El rol no está aquí a propósito. */
const SELF_FIELDS = ["name", "lastname", "phone", "signalHandle", "telegramChatId", "photo", "position"];

/**
 * Edición del perfil propio, para cualquier rol. Deliberadamente **no** deja
 * tocar `roleId`, `active`, `premium` ni `categoryIds`: eso es del admin. El
 * correo sí, porque es con lo que la persona entra, pero validando que no lo
 * tenga ya alguien más.
 */
export async function updateMe(req: AuthRequest, res: Response) {
  const user = await UserModel.findById(req.user!.userId);
  if (!user) throw new CustomError("Usuario no encontrado", 404);

  const body = req.body as Record<string, unknown>;
  const payload: Record<string, unknown> = {};

  for (const field of SELF_FIELDS) {
    if (field in body) payload[field] = String(body[field] ?? "").trim();
  }

  // Un nombre vacío dejaría la ficha sin identificar.
  if ("name" in payload && !String(payload.name || "").length) {
    throw new CustomError("El nombre no puede quedar vacío", 400);
  }

  if (typeof body.email === "string") {
    const email = body.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new CustomError("El correo no es válido", 400);

    const ocupado = await UserModel.findOne({ email, _id: { $ne: user._id } }).select("_id");
    if (ocupado) throw new CustomError("Ese correo ya está en uso", 409);

    payload.email = email;
  }

  Object.assign(user, payload);
  await user.save();

  res.json({ data: sanitize(user.toObject()), message: "Perfil actualizado" });
}

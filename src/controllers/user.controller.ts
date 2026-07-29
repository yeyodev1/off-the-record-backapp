import { Response } from "express";
import { UserModel } from "../models/user.model";
import { AuthRequest } from "../types/AuthRequest";
import { CustomError } from "../errors/customError.error";
import { hashPassword } from "../utils/password";

function sanitize(user: Record<string, unknown>) {
  const { password, tokenVersion, ...safe } = user;
  return safe;
}

export async function listUsers(req: AuthRequest, res: Response) {
  const search = String(req.query.search || "").trim();
  const filter = search ? { $or: ["name", "lastname", "email"].map((field) => ({ [field]: { $regex: search, $options: "i" } })) } : {};
  const users = await UserModel.find(filter).select("+password").sort({ createdAt: -1 });
  const data = users.map((user) => sanitize(user.toObject()));
  res.json({ data, total: data.length, page: 1, limit: data.length });
}

export async function createUser(req: AuthRequest, res: Response) {
  const { name, lastname = "", email, password, roleId = 2, active = true } = req.body as Record<string, unknown>;
  if (!name || !email || typeof password !== "string" || password.length < 8) {
    throw new CustomError("name, email and a password with at least 8 characters are required", 400);
  }

  const normalizedEmail = String(email).toLowerCase();
  if (await UserModel.exists({ email: normalizedEmail })) throw new CustomError("Email already registered", 409);

  const user = await UserModel.create({
    name,
    lastname,
    email: normalizedEmail,
    password: await hashPassword(password),
    roleId: Number(roleId),
    active: Boolean(active),
  });
  res.status(201).json({ data: sanitize(user.toObject()), message: "User created" });
}

export async function updateUser(req: AuthRequest, res: Response) {
  const body = { ...(req.body as Record<string, unknown>) };
  delete body.tokenVersion;
  if (typeof body.email === "string") body.email = body.email.toLowerCase();
  if (typeof body.password === "string" && body.password.length > 0) body.password = await hashPassword(body.password);
  else delete body.password;

  const user = await UserModel.findByIdAndUpdate(req.params.id, body, { new: true, runValidators: true }).select("+password");
  if (!user) throw new CustomError("User not found", 404);
  res.json({ data: sanitize(user.toObject()), message: "User updated" });
}

export async function deleteUser(req: AuthRequest, res: Response) {
  if (req.params.id === req.user!.userId) {
    throw new CustomError("You cannot delete your own account", 400);
  }

  const user = await UserModel.findByIdAndDelete(req.params.id);
  if (!user) throw new CustomError("User not found", 404);
  res.json({ message: "User deleted" });
}

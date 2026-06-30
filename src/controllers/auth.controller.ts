import { Response } from "express";
import { UserModel } from "../models/user.model";
import { comparePassword, hashPassword } from "../utils/password";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../utils/jwt";
import { AuthRequest } from "../types/AuthRequest";
import { CustomError } from "../errors/customError.error";

function buildTokenPayload(user: { _id: unknown; email: string; roleId: number; tokenVersion: number; roleName?: string }) {
  return {
    userId: String(user._id),
    email: user.email,
    roleId: user.roleId,
    roleName: user.roleName || (user.roleId === 1 ? "Admin" : user.roleId === 2 ? "Reader" : "Writer"),
    tokenVersion: user.tokenVersion || 0,
  };
}

function sanitizeUser(user: Record<string, unknown>) {
  const { password, tokenVersion, ...safe } = user;
  return safe;
}

export async function signUp(req: AuthRequest, res: Response) {
  const { name, lastname, ci, email, password, phone, roleId, active } = req.body as Record<string, unknown>;

  if (!name || !email || !password) {
    throw new CustomError("name, email and password are required", 400);
  }

  const existing = await UserModel.findOne({ email: String(email).toLowerCase() }).select("+password");
  if (existing) {
    throw new CustomError("Email already registered", 409);
  }

  const user = await UserModel.create({
    name,
    lastname: lastname || "",
    ci: ci || "",
    email: String(email).toLowerCase(),
    password: await hashPassword(String(password)),
    phone: phone || "",
    roleId: Number(roleId) || 3,
    active: typeof active === "boolean" ? active : false,
    changepass: false,
  });

  res.status(201).json({ data: sanitizeUser(user.toObject()), message: "User created" });
}

export async function signIn(req: AuthRequest, res: Response) {
  const { email, password } = req.body as Record<string, unknown>;

  if (!email || !password) {
    throw new CustomError("email and password are required", 400);
  }

  const user = await UserModel.findOne({ email: String(email).toLowerCase() }).select("+password");

  if (!user) {
    throw new CustomError("Invalid credentials", 401);
  }

  if (!user.active) {
    throw new CustomError("User is inactive", 403);
  }

  const ok = await comparePassword(String(password), user.password);
  if (!ok) {
    throw new CustomError("Invalid credentials", 401);
  }

  const payload = buildTokenPayload(user.toObject());
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);

  res.json({
    accessToken,
    refreshToken,
    user: sanitizeUser(user.toObject()),
  });
}

export async function refreshAccessToken(req: AuthRequest, res: Response) {
  const { refreshToken } = req.body as Record<string, unknown>;

  if (!refreshToken || typeof refreshToken !== "string") {
    throw new CustomError("refreshToken is required", 400);
  }

  const payload = verifyRefreshToken(refreshToken);
  const user = await UserModel.findById(payload.userId).select("+password");

  if (!user || !user.active || user.tokenVersion !== payload.tokenVersion) {
    throw new CustomError("Invalid refresh token", 401);
  }

  res.json({ accessToken: signAccessToken(buildTokenPayload(user.toObject())) });
}

export async function recoverPassword(req: AuthRequest, res: Response) {
  const { email, password } = req.body as Record<string, unknown>;

  if (!email) {
    throw new CustomError("email is required", 400);
  }

  const user = await UserModel.findOne({ email: String(email).toLowerCase() });

  if (!user) {
    throw new CustomError("User not found", 404);
  }

  if (typeof password === "string" && password.length >= 8) {
    user.password = await hashPassword(password);
    user.changepass = false;
    user.tokenVersion += 1;
    await user.save();
  } else {
    user.changepass = true;
    await user.save();
  }

  res.json({ message: "Recovery updated" });
}

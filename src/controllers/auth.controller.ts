import { Response } from "express";
import { UserModel } from "../models/user.model";
import { AccessLogModel } from "../models/accessLog.model";
import { comparePassword, hashPassword } from "../utils/password";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../utils/jwt";
import { AuthRequest } from "../types/AuthRequest";
import { CustomError } from "../errors/customError.error";
import { ROLE_NAMES } from "../middlewares/role.middleware";

function buildTokenPayload(user: {
  _id: unknown;
  email: string;
  roleId: number;
  tokenVersion: number;
  roleName?: string;
}) {
  return {
    userId: String(user._id),
    email: user.email,
    roleId: user.roleId,
    roleName: user.roleName || ROLE_NAMES[user.roleId] || "Reader",
    tokenVersion: user.tokenVersion || 0,
  };
}

function sanitizeUser(user: Record<string, unknown>) {
  const { password, tokenVersion, ...safe } = user;
  return safe;
}

async function logAccess(
  req: AuthRequest,
  action: "login" | "logout" | "failed" | "refresh",
  user?: { _id?: unknown; name?: string; email?: string; roleId?: number },
  reason = "",
) {
  try {
    await AccessLogModel.create({
      userId: user?._id ? String(user._id) : "",
      userName: user?.name || "",
      email: user?.email || String((req.body as Record<string, unknown>)?.email || ""),
      roleId: user?.roleId || 0,
      action,
      ip: req.ip || "",
      userAgent: String(req.headers["user-agent"] || ""),
      reason,
      at: new Date(),
    });
  } catch (error) {
    console.error("No se pudo registrar el acceso", error);
  }
}

export async function signIn(req: AuthRequest, res: Response) {
  const { email, password } = req.body as Record<string, unknown>;

  if (!email || !password) {
    throw new CustomError("Email y contraseña son obligatorios", 400);
  }

  const user = await UserModel.findOne({ email: String(email).toLowerCase() }).select("+password");

  if (!user) {
    await logAccess(req, "failed", undefined, "Usuario inexistente");
    throw new CustomError("Credenciales inválidas", 401);
  }

  if (!user.active) {
    await logAccess(req, "failed", user.toObject(), "Usuario inactivo");
    throw new CustomError("El usuario está inactivo", 403);
  }

  const ok = await comparePassword(String(password), user.password);
  if (!ok) {
    await logAccess(req, "failed", user.toObject(), "Contraseña incorrecta");
    throw new CustomError("Credenciales inválidas", 401);
  }

  user.lastLoginAt = new Date();
  user.loginCount = (user.loginCount || 0) + 1;
  await user.save();

  const payload = buildTokenPayload(user.toObject());
  await logAccess(req, "login", user.toObject());

  res.json({
    accessToken: signAccessToken(payload),
    refreshToken: signRefreshToken(payload),
    user: sanitizeUser(user.toObject()),
  });
}

export async function signOut(req: AuthRequest, res: Response) {
  if (req.user) {
    const user = await UserModel.findById(req.user.userId);
    await logAccess(req, "logout", user?.toObject());
  }
  res.json({ message: "Sesión cerrada" });
}

export async function refreshAccessToken(req: AuthRequest, res: Response) {
  const { refreshToken } = req.body as Record<string, unknown>;

  if (!refreshToken || typeof refreshToken !== "string") {
    throw new CustomError("refreshToken es obligatorio", 400);
  }

  const payload = verifyRefreshToken(refreshToken);
  const user = await UserModel.findById(payload.userId);

  if (!user || !user.active || user.tokenVersion !== payload.tokenVersion) {
    throw new CustomError("Refresh token inválido", 401);
  }

  res.json({ accessToken: signAccessToken(buildTokenPayload(user.toObject())) });
}

export async function changeOwnPassword(req: AuthRequest, res: Response) {
  const { currentPassword, newPassword } = req.body as Record<string, unknown>;

  if (typeof newPassword !== "string" || newPassword.length < 8) {
    throw new CustomError("La nueva contraseña debe tener al menos 8 caracteres", 400);
  }

  const user = await UserModel.findById(req.user!.userId).select("+password");
  if (!user) throw new CustomError("Usuario no encontrado", 404);

  const ok = await comparePassword(String(currentPassword || ""), user.password);
  if (!ok) throw new CustomError("La contraseña actual no coincide", 401);

  user.password = await hashPassword(newPassword);
  user.changepass = false;
  user.tokenVersion += 1;
  await user.save();

  res.json({ message: "Contraseña actualizada. Vuelve a iniciar sesión." });
}

export async function recoverPassword(req: AuthRequest, res: Response) {
  const { email } = req.body as Record<string, unknown>;

  if (!email) throw new CustomError("El email es obligatorio", 400);

  const user = await UserModel.findOne({ email: String(email).toLowerCase() });
  if (user) {
    user.changepass = true;
    await user.save();
  }

  // Respuesta uniforme para no revelar qué correos existen.
  res.json({ message: "Si el correo existe, un administrador restablecerá el acceso." });
}

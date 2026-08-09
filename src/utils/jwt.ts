import jwt from "jsonwebtoken";
import { JwtPayload } from "../types/AuthRequest";

type TokenKind = "access" | "refresh";

function getSecret(kind: TokenKind) {
  if (kind === "refresh") {
    return process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET || "change-me-refresh";
  }

  return process.env.JWT_SECRET || "change-me-access";
}

export function signAccessToken(payload: JwtPayload) {
  return jwt.sign(payload, getSecret("access"), { expiresIn: "30m" });
}

export function signRefreshToken(payload: JwtPayload) {
  return jwt.sign(payload, getSecret("refresh"), { expiresIn: "14d" });
}

export function verifyAccessToken(token: string) {
  return jwt.verify(token, getSecret("access")) as JwtPayload;
}

export function verifyRefreshToken(token: string) {
  return jwt.verify(token, getSecret("refresh")) as JwtPayload;
}

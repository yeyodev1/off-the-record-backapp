import { Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { AuthRequest, JwtPayload } from "../types/AuthRequest";

const fallbackSecret = process.env.JWT_SECRET || "change-me-access";

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const rawToken = req.headers["x-access-token"];
  const tokenValue = typeof rawToken === "string" ? rawToken : undefined;

  if (!authHeader && !tokenValue) {
    res.status(401).json({ message: "No token provided" });
    return;
  }

  const token = authHeader?.startsWith("Bearer ") ? authHeader.split(" ")[1] : tokenValue || authHeader || "";

  try {
    const decoded = jwt.verify(token, fallbackSecret) as JwtPayload;
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ message: "Invalid or expired token" });
    return;
  }
}

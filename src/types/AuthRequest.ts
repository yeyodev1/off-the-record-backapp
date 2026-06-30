import { Request } from "express";

export interface JwtPayload {
  userId: string;
  email: string;
  roleId: number;
  roleName: string;
  tokenVersion: number;
}

export interface AuthRequest extends Request {
  user?: JwtPayload;
}

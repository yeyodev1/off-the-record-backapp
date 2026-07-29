import { NextFunction, Response } from "express";
import { AuthRequest } from "../types/AuthRequest";

export const ADMIN_ROLE_ID = 1;
export const EDITOR_ROLE_ID = 3;

export function requireRoles(...roleIds: number[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roleIds.includes(req.user.roleId)) {
      res.status(403).json({ message: "You do not have permission to perform this action" });
      return;
    }

    next();
  };
}

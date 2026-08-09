import { NextFunction, Response } from "express";
import { AuthRequest } from "../types/AuthRequest";

export const ADMIN_ROLE_ID = 1;
export const READER_ROLE_ID = 2;
export const EDITOR_ROLE_ID = 3;
export const SUPERADMIN_ROLE_ID = 4;

export const ROLE_NAMES: Record<number, string> = {
  [ADMIN_ROLE_ID]: "Admin",
  [READER_ROLE_ID]: "Reader",
  [EDITOR_ROLE_ID]: "Writer",
  [SUPERADMIN_ROLE_ID]: "Superadmin",
};

/** Superadmin is a strict superset of admin, so it satisfies every role gate. */
export function requireRoles(...roleIds: number[]) {
  const allowed = new Set([...roleIds, SUPERADMIN_ROLE_ID]);

  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !allowed.has(req.user.roleId)) {
      res.status(403).json({ message: "No tienes permisos para realizar esta acción" });
      return;
    }

    next();
  };
}

export function isAdminLike(roleId?: number) {
  return roleId === ADMIN_ROLE_ID || roleId === SUPERADMIN_ROLE_ID;
}

export function isSuperadmin(roleId?: number) {
  return roleId === SUPERADMIN_ROLE_ID;
}

/** Only the superadmin sees per-person read receipts. */
export function requireSuperadmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (!isSuperadmin(req.user?.roleId)) {
    res.status(403).json({ message: "Solo el superadministrador puede consultar los acuses de lectura" });
    return;
  }

  next();
}

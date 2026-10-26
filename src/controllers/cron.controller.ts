import { timingSafeEqual } from "crypto";
import { NextFunction, Request, Response } from "express";
import { runScheduler } from "../services/scheduler.service";

/**
 * En Vercel no hay proceso vivo que corra el `setInterval` de index.ts: cada
 * petición es una función aparte. El cron de vercel.json llama aquí cada
 * minuto con `Authorization: Bearer $CRON_SECRET` para publicar lo
 * programado, despachar notificaciones y generar reportes.
 */
export function requireCronSecret(req: Request, res: Response, next: NextFunction) {
  const secret = process.env.CRON_SECRET || "";
  const header = String(req.headers.authorization || "");
  const expected = `Bearer ${secret}`;

  const ok =
    Boolean(secret) &&
    header.length === expected.length &&
    timingSafeEqual(Buffer.from(header), Buffer.from(expected));

  if (!ok) {
    res.status(401).json({ message: "No autorizado" });
    return;
  }

  next();
}

export async function tick(_req: Request, res: Response) {
  const inicio = Date.now();
  await runScheduler();
  res.json({ ok: true, ms: Date.now() - inicio });
}

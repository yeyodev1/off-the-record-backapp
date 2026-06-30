import { Response } from "express";

export function healthCheck(_req: unknown, res: Response) {
  res.json({ message: "Off The Record backend is alive" });
}

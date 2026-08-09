import { Response } from "express";
import { AuthRequest } from "../types/AuthRequest";
import {
  accessTimeline,
  dailyBrief,
  dashboardOverview,
  readsBySection,
  readsTimeline,
  topContent,
  topReaders,
} from "../services/analytics.service";
import { AccessLogModel } from "../models/accessLog.model";
import { ReadEventModel } from "../models/readEvent.model";

function days(req: AuthRequest, fallback: number) {
  const value = Number(req.query.days);
  return Number.isFinite(value) && value > 0 && value <= 365 ? value : fallback;
}

export async function overview(req: AuthRequest, res: Response) {
  const [stats, sections, top, timeline, logins] = await Promise.all([
    dashboardOverview(),
    readsBySection(days(req, 30)),
    topContent(days(req, 30), 8),
    readsTimeline(days(req, 14)),
    accessTimeline(days(req, 14)),
  ]);

  res.json({ data: { stats, sections, top, timeline, logins } });
}

export async function sections(req: AuthRequest, res: Response) {
  res.json({ data: await readsBySection(days(req, 30)) });
}

export async function top(req: AuthRequest, res: Response) {
  res.json({ data: await topContent(days(req, 30), 20) });
}

export async function readers(req: AuthRequest, res: Response) {
  res.json({ data: await topReaders(days(req, 30), 12) });
}

export async function brief(_req: AuthRequest, res: Response) {
  res.json({ data: await dailyBrief() });
}

export async function accessLog(req: AuthRequest, res: Response) {
  const limit = Math.min(200, Number(req.query.limit) || 60);
  const data = await AccessLogModel.find({}).sort({ at: -1 }).limit(limit);
  res.json({ data });
}

export async function readLog(req: AuthRequest, res: Response) {
  const limit = Math.min(200, Number(req.query.limit) || 60);
  const filter: Record<string, unknown> = {};
  if (req.query.targetId) filter.targetId = String(req.query.targetId);
  if (req.query.userId) filter.userId = String(req.query.userId);

  const data = await ReadEventModel.find(filter).sort({ readAt: -1 }).limit(limit);
  res.json({ data });
}

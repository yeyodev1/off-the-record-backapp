import { Response } from "express";
import { isValidObjectId } from "mongoose";
import { AuthRequest } from "../types/AuthRequest";
import { CustomError } from "../errors/customError.error";
import { ReportModel } from "../models/report.model";
import { generateReport, type ReportKind } from "../services/report.service";

function parseKind(value: unknown): ReportKind {
  return value === "monthly" ? "monthly" : "daily";
}

export async function listReports(req: AuthRequest, res: Response) {
  const kind = String(req.query.kind || "").trim();
  const filter: Record<string, unknown> = {};
  if (kind === "daily" || kind === "monthly") filter.kind = kind;

  const data = await ReportModel.find(filter).sort({ periodStart: -1 }).limit(120);
  res.json({ data });
}

export async function latestReport(req: AuthRequest, res: Response) {
  const kind = parseKind(req.query.kind);
  const data = await ReportModel.findOne({ kind }).sort({ periodStart: -1 });
  res.json({ data });
}

export async function getReport(req: AuthRequest, res: Response) {
  const id = String(req.params.id || "");
  if (!isValidObjectId(id)) throw new CustomError("Identificador inválido", 400);

  const data = await ReportModel.findById(id);
  if (!data) throw new CustomError("Reporte no encontrado", 404);

  res.json({ data });
}

/** Generación a demanda desde el panel. */
export async function createReport(req: AuthRequest, res: Response) {
  const body = req.body as Record<string, unknown>;
  const kind = parseKind(body.kind);

  const reference = body.date ? new Date(String(body.date)) : new Date(Date.now() - 86400_000);
  if (Number.isNaN(reference.getTime())) throw new CustomError("Fecha inválida", 400);

  const report = await generateReport(kind, reference, "manual");

  res.status(201).json({
    data: report,
    message: report?.error ? "Reporte generado con las cifras, pero sin narrativa de IA" : "Reporte generado",
  });
}

export async function deleteReport(req: AuthRequest, res: Response) {
  const id = String(req.params.id || "");
  if (!isValidObjectId(id)) throw new CustomError("Identificador inválido", 400);

  const removed = await ReportModel.findByIdAndDelete(id);
  if (!removed) throw new CustomError("Reporte no encontrado", 404);

  res.json({ message: "Reporte eliminado" });
}

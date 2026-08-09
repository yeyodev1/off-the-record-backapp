import { ReportModel } from "../models/report.model";
import { ArticleModel } from "../models/article.model";
import { UpdateModel } from "../models/update.model";
import { ReadEventModel } from "../models/readEvent.model";
import { AccessLogModel } from "../models/accessLog.model";
import { UserModel } from "../models/user.model";
import { IndicatorModel } from "../models/indicator.model";
import { NEWSROOM_SYSTEM, completeJson, INFOGRAPHIC_SCHEMA, type InfographicSpec } from "./ai.service";

export type ReportKind = "daily" | "monthly";

/**
 * La redacción trabaja en Ecuador (UTC-5). Guardamos los períodos en UTC pero
 * los calculamos sobre la hora local para que "el día" sea el día real.
 */
const TZ_OFFSET_HOURS = Number(process.env.REPORT_TIMEZONE_OFFSET ?? -5);
const DAILY_HOUR = Number(process.env.REPORT_DAILY_HOUR ?? 7);
const OFFSET_MS = TZ_OFFSET_HOURS * 3600_000;

function toLocal(date: Date) {
  return new Date(date.getTime() + OFFSET_MS);
}

function fromLocal(date: Date) {
  return new Date(date.getTime() - OFFSET_MS);
}

export function periodOf(kind: ReportKind, reference: Date) {
  const local = toLocal(reference);

  if (kind === "daily") {
    const start = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
    const end = new Date(start.getTime() + 86400_000);
    const key = start.toISOString().slice(0, 10);
    return { key, periodStart: fromLocal(start), periodEnd: fromLocal(end) };
  }

  const start = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1));
  const end = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1));
  const key = start.toISOString().slice(0, 7);
  return { key, periodStart: fromLocal(start), periodEnd: fromLocal(end) };
}

const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

function periodLabel(kind: ReportKind, periodStart: Date) {
  const local = toLocal(periodStart);
  if (kind === "daily") {
    return `${local.getUTCDate()} de ${MONTHS[local.getUTCMonth()]} de ${local.getUTCFullYear()}`;
  }
  return `${MONTHS[local.getUTCMonth()]} de ${local.getUTCFullYear()}`;
}

/* ------------------------------------------------------------------ */
/* Recolección de métricas                                             */
/* ------------------------------------------------------------------ */

async function gather(periodStart: Date, periodEnd: Date) {
  const range = { $gte: periodStart, $lt: periodEnd };

  const [reads, uniqueReaders, sections, topContent, articles, updates, logins, activeUsers, indicators] =
    await Promise.all([
      ReadEventModel.countDocuments({ readAt: range }),
      ReadEventModel.distinct("userId", { readAt: range, userId: { $nin: ["", null] } }),
      ReadEventModel.aggregate([
        { $match: { readAt: range } },
        { $group: { _id: "$categoryName", reads: { $sum: 1 }, readers: { $addToSet: "$userId" } } },
        { $project: { _id: 0, title: { $ifNull: ["$_id", "Sin sección"] }, reads: 1, uniqueReaders: { $size: "$readers" } } },
        { $sort: { reads: -1 } },
        { $limit: 12 },
      ]),
      ReadEventModel.aggregate([
        { $match: { readAt: range } },
        {
          $group: {
            _id: { id: "$targetId", kind: "$targetType", title: "$targetTitle", category: "$categoryName" },
            reads: { $sum: 1 },
            readers: { $addToSet: "$userId" },
          },
        },
        {
          $project: {
            _id: 0,
            id: "$_id.id",
            kind: "$_id.kind",
            title: "$_id.title",
            category: { $ifNull: ["$_id.category", "Sin sección"] },
            reads: 1,
            uniqueReaders: { $size: "$readers" },
          },
        },
        { $sort: { reads: -1 } },
        { $limit: 10 },
      ]),
      ArticleModel.find({ status: "published", publishedAt: range })
        .sort({ publishedAt: -1 })
        .select("title categoryName accentColor stats"),
      UpdateModel.find({ status: "published", publishedAt: range })
        .sort({ publishedAt: -1 })
        .select("title categoryName accentColor stats"),
      AccessLogModel.countDocuments({ at: range, action: "login" }),
      AccessLogModel.distinct("userId", { at: range, action: "login", userId: { $nin: ["", null] } }),
      IndicatorModel.find({ active: true }).sort({ order: 1 }),
    ]);

  const published = [
    ...articles.map((doc) => {
      const item = doc.toObject();
      return {
        id: String(item._id),
        kind: "article",
        title: item.title,
        category: item.categoryName || "Sin sección",
        reads: item.stats?.views || 0,
        uniqueReaders: item.stats?.uniqueViews || 0,
        color: item.accentColor || "#C8392B",
      };
    }),
    ...updates.map((doc) => {
      const item = doc.toObject();
      return {
        id: String(item._id),
        kind: "update",
        title: item.title,
        category: item.categoryName || "Sin sección",
        reads: item.stats?.views || 0,
        uniqueReaders: item.stats?.uniqueViews || 0,
        color: item.accentColor || "#2094D2",
      };
    }),
  ];

  const totalReaders = await UserModel.countDocuments({ active: true, roleId: 2 });

  return {
    reads,
    uniqueReaders: uniqueReaders.filter(Boolean).length,
    sections,
    topContent,
    published,
    logins,
    activeUsers: activeUsers.filter(Boolean).length,
    totalReaders,
    indicators: indicators.map((doc) => {
      const item = doc.toObject();
      const previous = typeof item.previousValue === "number" ? item.previousValue : null;
      return {
        name: item.name,
        code: item.code,
        value: item.value,
        unit: item.unit,
        format: item.format,
        color: item.color,
        source: item.source,
        deltaPercent:
          previous !== null && previous !== 0 ? Number((((item.value - previous) / Math.abs(previous)) * 100).toFixed(2)) : null,
      };
    }),
  };
}

/* ------------------------------------------------------------------ */
/* Narrativa generada por el agente                                    */
/* ------------------------------------------------------------------ */

const NARRATIVE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headline: { type: "string", description: "Una frase que resuma el período" },
    narrative: { type: "string", description: "Dos o tres párrafos de análisis, en español" },
    highlights: { type: "array", items: { type: "string" } },
    recommendations: { type: "array", items: { type: "string" } },
  },
  required: ["headline", "narrative", "highlights", "recommendations"],
};

interface Narrative {
  headline: string;
  narrative: string;
  highlights: string[];
  recommendations: string[];
}

function describeData(kind: ReportKind, label: string, data: Awaited<ReturnType<typeof gather>>) {
  const lines = [
    `Período: ${kind === "daily" ? "día" : "mes"} de ${label}.`,
    `Lecturas totales: ${data.reads}. Lectores distintos: ${data.uniqueReaders} de ${data.totalReaders} suscriptores activos.`,
    `Ingresos al sistema: ${data.logins}, de ${data.activeUsers} personas distintas.`,
    `Piezas publicadas: ${data.published.length}.`,
    "",
    "Publicado en el período:",
    ...(data.published.length
      ? data.published.map((item) => `- [${item.kind === "article" ? "reportaje" : "actualización"}] ${item.title} (${item.category}) — ${item.reads} lecturas`)
      : ["- (nada)"]),
    "",
    "Lecturas por sección:",
    ...(data.sections.length
      ? data.sections.map((s: { title: string; reads: number; uniqueReaders: number }) => `- ${s.title}: ${s.reads} lecturas, ${s.uniqueReaders} lectores`)
      : ["- (sin lecturas)"]),
    "",
    "Contenido más leído:",
    ...(data.topContent.length
      ? data.topContent.map((t: { title: string; reads: number }) => `- ${t.title}: ${t.reads} lecturas`)
      : ["- (sin lecturas)"]),
    "",
    "Indicadores económicos:",
    ...(data.indicators.length
      ? data.indicators.map(
          (i) => `- ${i.name}: ${i.value}${i.unit ? ` ${i.unit}` : ""}${i.deltaPercent !== null ? ` (${i.deltaPercent > 0 ? "+" : ""}${i.deltaPercent}%)` : ""}`,
        )
      : ["- (sin indicadores)"]),
  ];

  return lines.join("\n");
}

async function buildNarrative(kind: ReportKind, label: string, data: Awaited<ReturnType<typeof gather>>) {
  const dossier = describeData(kind, label, data);

  const narrative = await completeJson<Narrative>(
    NEWSROOM_SYSTEM,
    [
      `Redacta el reporte ${kind === "daily" ? "diario" : "mensual"} de la redacción para el equipo directivo.`,
      "Analiza únicamente las cifras entregadas: qué se publicó, qué se leyó, qué secciones funcionaron y qué indicadores se movieron.",
      "No inventes datos ni menciones cifras que no aparezcan abajo. Si un dato es cero, dilo con naturalidad.",
      "`highlights`: entre 3 y 5 hallazgos concretos. `recommendations`: entre 2 y 4 acciones editoriales para el siguiente período.",
      "",
      dossier,
    ].join("\n"),
    NARRATIVE_SCHEMA,
    3000,
  );

  let chart: InfographicSpec | null = null;
  if (data.sections.length) {
    try {
      chart = await completeJson<InfographicSpec>(
        NEWSROOM_SYSTEM,
        [
          "Arma una infografía con las lecturas por sección de este período.",
          "Usa kind='bar' o 'donut'. Colores hexadecimales con buen contraste sobre fondo oscuro.",
          "",
          dossier,
        ].join("\n"),
        INFOGRAPHIC_SCHEMA,
        2500,
      );
    } catch (error) {
      console.error("No se pudo generar el gráfico del reporte", error);
    }
  }

  return { narrative, chart };
}

/* ------------------------------------------------------------------ */
/* Generación y persistencia                                           */
/* ------------------------------------------------------------------ */

export async function generateReport(kind: ReportKind, reference: Date, generatedBy: "auto" | "manual" = "auto") {
  const { key, periodStart, periodEnd } = periodOf(kind, reference);
  const label = periodLabel(kind, periodStart);
  const data = await gather(periodStart, periodEnd);

  let narrative: Narrative = {
    headline: `${data.reads} lecturas y ${data.published.length} piezas publicadas`,
    narrative: "",
    highlights: [],
    recommendations: [],
  };
  let chart: InfographicSpec | null = null;
  let engine = "sin-ia";
  let error = "";

  try {
    const generated = await buildNarrative(kind, label, data);
    narrative = generated.narrative;
    chart = generated.chart;
    engine = process.env.AI_TEXT_PROVIDER || "gemini";
  } catch (caught) {
    // El reporte se guarda igual con las cifras; solo pierde la narrativa.
    error = caught instanceof Error ? caught.message : "Falló la generación con IA";
    console.error("Reporte sin narrativa:", error);
  }

  const metrics = [
    { label: "Lecturas", value: data.reads, unit: "", delta: null, color: "#C8392B" },
    { label: "Lectores distintos", value: data.uniqueReaders, unit: "", delta: null, color: "#57A773" },
    { label: "Piezas publicadas", value: data.published.length, unit: "", delta: null, color: "#7B6CF6" },
    { label: "Ingresos", value: data.logins, unit: "", delta: null, color: "#2094D2" },
  ];

  const payload = {
    kind,
    periodKey: key,
    periodStart,
    periodEnd,
    title: `Reporte ${kind === "daily" ? "diario" : "mensual"} · ${label}`,
    headline: narrative.headline,
    narrative: narrative.narrative,
    highlights: narrative.highlights,
    recommendations: narrative.recommendations,
    metrics,
    sections: data.sections,
    topContent: data.topContent,
    published: data.published,
    indicators: data.indicators,
    chart,
    engine,
    generatedBy,
    generatedAt: new Date(),
    error,
  };

  const report = await ReportModel.findOneAndUpdate({ kind, periodKey: key }, payload, {
    new: true,
    upsert: true,
    setDefaultsOnInsert: true,
  });

  return report;
}

/**
 * Llamado por el scheduler cada minuto. Genera el reporte del día anterior una
 * vez pasada la hora configurada, y el del mes anterior el primer día del mes.
 */
export async function ensureScheduledReports() {
  const now = new Date();
  const local = toLocal(now);

  if (local.getUTCHours() < DAILY_HOUR) return;

  const yesterday = new Date(now.getTime() - 86400_000);
  const daily = periodOf("daily", yesterday);

  const hasDaily = await ReportModel.exists({ kind: "daily", periodKey: daily.key });
  if (!hasDaily) {
    console.log(`Generando reporte diario ${daily.key}…`);
    await generateReport("daily", yesterday, "auto");
  }

  // El mensual se arma cuando ya empezó el mes siguiente.
  const lastMonth = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - 86400_000);
  const monthly = periodOf("monthly", fromLocal(lastMonth));

  const hasMonthly = await ReportModel.exists({ kind: "monthly", periodKey: monthly.key });
  if (!hasMonthly) {
    console.log(`Generando reporte mensual ${monthly.key}…`);
    await generateReport("monthly", fromLocal(lastMonth), "auto");
  }
}

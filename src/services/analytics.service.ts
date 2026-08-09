import { ArticleModel } from "../models/article.model";
import { UpdateModel } from "../models/update.model";
import { ReadEventModel } from "../models/readEvent.model";
import { AccessLogModel } from "../models/accessLog.model";
import { UserModel } from "../models/user.model";
import { IndicatorModel } from "../models/indicator.model";

function sinceDays(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(0, 0, 0, 0);
  return date;
}

export async function readsBySection(days = 30) {
  const rows = await ReadEventModel.aggregate([
    { $match: { readAt: { $gte: sinceDays(days) } } },
    {
      $group: {
        _id: { categoryId: "$categoryId", categoryName: "$categoryName" },
        reads: { $sum: 1 },
        readers: { $addToSet: "$userId" },
        seconds: { $sum: "$seconds" },
      },
    },
    {
      $project: {
        _id: 0,
        categoryId: "$_id.categoryId",
        categoryName: { $ifNull: ["$_id.categoryName", "Sin sección"] },
        reads: 1,
        uniqueReaders: { $size: "$readers" },
        avgSeconds: { $cond: [{ $eq: ["$reads", 0] }, 0, { $divide: ["$seconds", "$reads"] }] },
      },
    },
    { $sort: { reads: -1 } },
  ]);

  return rows;
}

export async function topContent(days = 30, limit = 10) {
  return ReadEventModel.aggregate([
    { $match: { readAt: { $gte: sinceDays(days) } } },
    {
      $group: {
        _id: { targetType: "$targetType", targetId: "$targetId", targetTitle: "$targetTitle", categoryName: "$categoryName" },
        reads: { $sum: 1 },
        readers: { $addToSet: "$userId" },
        seconds: { $sum: "$seconds" },
      },
    },
    {
      $project: {
        _id: 0,
        targetType: "$_id.targetType",
        targetId: "$_id.targetId",
        title: "$_id.targetTitle",
        categoryName: { $ifNull: ["$_id.categoryName", "Sin sección"] },
        reads: 1,
        uniqueReaders: { $size: "$readers" },
        avgSeconds: { $cond: [{ $eq: ["$reads", 0] }, 0, { $divide: ["$seconds", "$reads"] }] },
      },
    },
    { $sort: { reads: -1 } },
    { $limit: limit },
  ]);
}

export async function readsTimeline(days = 14) {
  return ReadEventModel.aggregate([
    { $match: { readAt: { $gte: sinceDays(days) } } },
    {
      $group: {
        _id: { $dateToString: { format: "%Y-%m-%d", date: "$readAt" } },
        reads: { $sum: 1 },
        readers: { $addToSet: "$userId" },
      },
    },
    { $project: { _id: 0, date: "$_id", reads: 1, uniqueReaders: { $size: "$readers" } } },
    { $sort: { date: 1 } },
  ]);
}

export async function accessTimeline(days = 14) {
  return AccessLogModel.aggregate([
    { $match: { at: { $gte: sinceDays(days) }, action: { $in: ["login", "failed"] } } },
    {
      $group: {
        _id: { date: { $dateToString: { format: "%Y-%m-%d", date: "$at" } }, action: "$action" },
        total: { $sum: 1 },
      },
    },
    { $project: { _id: 0, date: "$_id.date", action: "$_id.action", total: 1 } },
    { $sort: { date: 1 } },
  ]);
}

export async function topReaders(days = 30, limit = 8) {
  return ReadEventModel.aggregate([
    { $match: { readAt: { $gte: sinceDays(days) }, userId: { $ne: "" } } },
    {
      $group: {
        _id: { userId: "$userId", userName: "$userName", userEmail: "$userEmail" },
        reads: { $sum: 1 },
        seconds: { $sum: "$seconds" },
      },
    },
    {
      $project: {
        _id: 0,
        userId: "$_id.userId",
        name: "$_id.userName",
        email: "$_id.userEmail",
        reads: 1,
        minutes: { $round: [{ $divide: ["$seconds", 60] }, 1] },
      },
    },
    { $sort: { reads: -1 } },
    { $limit: limit },
  ]);
}

export async function dashboardOverview() {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [
    articles,
    published,
    scheduled,
    drafts,
    updates,
    scheduledUpdates,
    users,
    activeUsers,
    readsToday,
    reads30,
    loginsToday,
  ] = await Promise.all([
    ArticleModel.countDocuments({}),
    ArticleModel.countDocuments({ status: "published" }),
    ArticleModel.countDocuments({ status: "scheduled" }),
    ArticleModel.countDocuments({ status: { $in: ["draft", "review"] } }),
    UpdateModel.countDocuments({}),
    UpdateModel.countDocuments({ status: "scheduled" }),
    UserModel.countDocuments({}),
    UserModel.countDocuments({ active: true }),
    ReadEventModel.countDocuments({ readAt: { $gte: startOfDay } }),
    ReadEventModel.countDocuments({ readAt: { $gte: sinceDays(30) } }),
    AccessLogModel.countDocuments({ at: { $gte: startOfDay }, action: "login" }),
  ]);

  return {
    articles,
    published,
    scheduled,
    drafts,
    updates,
    scheduledUpdates,
    users,
    activeUsers,
    readsToday,
    reads30,
    loginsToday,
  };
}

/**
 * "Resumen del día": headlines chart + economic indicators, ready to render.
 */
export async function dailyBrief() {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [articles, updates, indicators, sections] = await Promise.all([
    ArticleModel.find({ status: "published" })
      .sort({ publishedAt: -1 })
      .limit(8)
      .select("title kicker summary accentColor categoryName publishedAt stats"),
    UpdateModel.find({ status: "published" })
      .sort({ publishedAt: -1 })
      .limit(8)
      .select("title summary accentColor categoryName publishedAt stats"),
    IndicatorModel.find({ active: true }).sort({ order: 1, name: 1 }),
    readsBySection(1),
  ]);

  const headlines = articles.map((article) => {
    const doc = article.toObject();
    return {
      id: String(doc._id),
      title: doc.title,
      kicker: doc.kicker,
      summary: doc.summary,
      color: doc.accentColor,
      category: doc.categoryName,
      publishedAt: doc.publishedAt,
      reads: doc.stats?.views || 0,
    };
  });

  return {
    date: startOfDay,
    headlines,
    updates: updates.map((update) => {
      const doc = update.toObject();
      return {
        id: String(doc._id),
        title: doc.title,
        summary: doc.summary,
        color: doc.accentColor,
        category: doc.categoryName,
        publishedAt: doc.publishedAt,
        reads: doc.stats?.views || 0,
      };
    }),
    indicators: indicators.map((indicator) => {
      const doc = indicator.toObject();
      const previous = typeof doc.previousValue === "number" ? doc.previousValue : null;
      const delta = previous !== null && previous !== 0 ? ((doc.value - previous) / Math.abs(previous)) * 100 : null;
      return {
        id: String(doc._id),
        name: doc.name,
        code: doc.code,
        value: doc.value,
        previousValue: previous,
        deltaPercent: delta === null ? null : Number(delta.toFixed(2)),
        unit: doc.unit,
        format: doc.format,
        color: doc.color,
        source: doc.source,
        history: doc.history,
        measuredAt: doc.measuredAt,
      };
    }),
    sections,
  };
}

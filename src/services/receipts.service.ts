import { UserModel } from "../models/user.model";
import { ReadEventModel } from "../models/readEvent.model";
import { NotificationModel } from "../models/notification.model";
import { READER_ROLE_ID } from "../middlewares/role.middleware";

export interface ReceiptRow {
  userId: string;
  name: string;
  email: string;
  roleId: number;
  organization: string;
  position: string;
  categoryNames: string[];
  read: boolean;
  readAt: string | null;
  times: number;
  seconds: number;
}

export interface ReceiptSummary {
  total: number;
  read: number;
  unread: number;
  rate: number;
  rows: ReceiptRow[];
}

interface AudienceFilter {
  audience?: string;
  roleId?: number | null;
  categoryId?: string;
  userIds?: string[];
}

/**
 * Resolves the people a notification (or a piece of content) was meant to reach.
 * Content has no explicit audience, so it falls back to every active account.
 */
async function resolveAudience(filter: AudienceFilter) {
  const query: Record<string, unknown> = { active: true };

  if (filter.audience === "users") {
    query._id = { $in: (filter.userIds || []).filter(Boolean) };
  } else if (filter.audience === "role" && typeof filter.roleId === "number") {
    query.roleId = filter.roleId;
  } else if (filter.audience === "category" && filter.categoryId) {
    query.categoryIds = filter.categoryId;
  }

  return UserModel.find(query).select("name lastname email roleId organization position categoryNames").sort({ name: 1 });
}

function buildSummary(rows: ReceiptRow[]): ReceiptSummary {
  const read = rows.filter((row) => row.read).length;
  return {
    total: rows.length,
    read,
    unread: rows.length - read,
    rate: rows.length ? Math.round((read / rows.length) * 100) : 0,
    rows,
  };
}

/** Who opened a reportaje / actualización, and who never did. */
export async function contentReceipts(targetType: "article" | "update", targetId: string): Promise<ReceiptSummary> {
  const [audience, events] = await Promise.all([
    resolveAudience({ audience: "all" }),
    ReadEventModel.aggregate<{ _id: string; readAt: Date; times: number; seconds: number }>([
      { $match: { targetType, targetId, userId: { $nin: ["", null] } } },
      {
        $group: {
          _id: "$userId",
          readAt: { $max: "$readAt" },
          times: { $sum: 1 },
          seconds: { $sum: "$seconds" },
        },
      },
    ]),
  ]);

  const byUser = new Map(events.map((event) => [String(event._id), event]));

  const rows: ReceiptRow[] = audience.map((user) => {
    const doc = user.toObject();
    const id = String(doc._id);
    const event = byUser.get(id);

    return {
      userId: id,
      name: `${doc.name} ${doc.lastname}`.trim(),
      email: doc.email,
      roleId: doc.roleId,
      organization: doc.organization || "",
      position: doc.position || "",
      categoryNames: doc.categoryNames || [],
      read: Boolean(event),
      readAt: event ? new Date(event.readAt).toISOString() : null,
      times: event?.times || 0,
      seconds: event?.seconds || 0,
    };
  });

  return buildSummary(rows);
}

/** Who has seen a notification, and who has it still pending. */
export async function notificationReceipts(notificationId: string): Promise<ReceiptSummary & { title: string }> {
  const notification = await NotificationModel.findById(notificationId);
  if (!notification) {
    return { ...buildSummary([]), title: "" };
  }

  const doc = notification.toObject();
  const audience = await resolveAudience({
    audience: doc.audience,
    roleId: doc.roleId,
    categoryId: doc.categoryId,
    userIds: doc.userIds,
  });

  const readSet = new Set((doc.readBy || []).map(String));

  const rows: ReceiptRow[] = audience.map((user) => {
    const raw = user.toObject();
    const id = String(raw._id);

    return {
      userId: id,
      name: `${raw.name} ${raw.lastname}`.trim(),
      email: raw.email,
      roleId: raw.roleId,
      organization: raw.organization || "",
      position: raw.position || "",
      categoryNames: raw.categoryNames || [],
      read: readSet.has(id),
      readAt: null,
      times: readSet.has(id) ? 1 : 0,
      seconds: 0,
    };
  });

  return { ...buildSummary(rows), title: doc.title };
}

/** Readers with no activity in the last `days` — useful to chase up clients. */
export async function inactiveReaders(days = 14) {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const activeIds = await ReadEventModel.distinct("userId", { readAt: { $gte: since }, userId: { $nin: ["", null] } });

  const users = await UserModel.find({
    active: true,
    roleId: READER_ROLE_ID,
    _id: { $nin: activeIds.filter(Boolean) },
  })
    .select("name lastname email organization lastLoginAt categoryNames")
    .sort({ lastLoginAt: 1 })
    .limit(200);

  return users.map((user) => {
    const doc = user.toObject();
    return {
      userId: String(doc._id),
      name: `${doc.name} ${doc.lastname}`.trim(),
      email: doc.email,
      organization: doc.organization || "",
      categoryNames: doc.categoryNames || [],
      lastLoginAt: doc.lastLoginAt,
    };
  });
}

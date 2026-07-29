import { ArticleModel } from "../models/article.model";

export async function publishDueArticles() {
  const now = new Date();

  await ArticleModel.updateMany(
    { status: "scheduled", scheduledFor: { $lte: now } },
    { $set: { status: "published", publishedAt: now } },
  );
}

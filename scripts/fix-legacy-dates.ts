/**
 * Repara las fechas de lo ya migrado: `createdAt` y `updatedAt` deben ser la
 * fecha original de la pieza, no la del traslado.
 *
 * Mongoose trata `createdAt` como inmutable y **descarta el `$set` en
 * silencio** (`updateOne` devuelve `acknowledged: false`, sin lanzar error),
 * así que hay que escribir por el driver crudo.
 *
 *   pnpm ts-node scripts/fix-legacy-dates.ts
 */
import "dotenv/config";
import mongoose from "mongoose";
import { ArticleModel } from "../src/models/article.model";
import { UpdateModel } from "../src/models/update.model";

(async () => {
  await mongoose.connect(process.env.DB_URI as string);
  let total = 0;

  for (const [label, model] of [["reportajes", ArticleModel], ["actualizaciones", UpdateModel]] as const) {
    const docs = await (model as any).find({ legacyId: { $exists: true, $nin: ["", null] } })
      .select("publishedAt createdAt").lean();
    let n = 0;
    for (const d of docs) {
      if (!d.publishedAt) continue;
      if (new Date(d.createdAt).getTime() === new Date(d.publishedAt).getTime()) continue;
      // Driver crudo: Mongoose bloquea el $set sobre createdAt.
      const r = await (model as any).collection.updateOne(
        { _id: d._id },
        { $set: { createdAt: new Date(d.publishedAt), updatedAt: new Date(d.publishedAt) } },
      );
      if (r.modifiedCount) n++;
    }
    console.log(`${label}: ${n} corregidos de ${docs.length} migrados`);
    total += n;
  }

  const muestra = await ArticleModel.find({ legacyId: { $exists: true, $nin: ["", null] } })
    .select("title publishedAt createdAt").sort({ publishedAt: -1 }).limit(5).lean();
  console.log("\ncomprobación (createdAt = publishedAt):");
  for (const d of muestra as any[]) {
    const ok = new Date(d.createdAt).getTime() === new Date(d.publishedAt).getTime();
    console.log(`  ${ok ? "✓" : "✗"} ${new Date(d.createdAt).toISOString().slice(0,10)}  ${String(d.title).slice(0,50)}`);
  }
  console.log(`\ntotal corregidos: ${total}`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });

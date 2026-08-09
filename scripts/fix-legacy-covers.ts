/**
 * Rellena `coverUrl` en el contenido ya guardado.
 *
 * El feed del lector ya no manda los bloques —eran el 90% del peso— así que la
 * portada tiene que estar resuelta en el documento.
 *
 *   pnpm ts-node scripts/fix-legacy-covers.ts            ← simulacro
 *   pnpm ts-node scripts/fix-legacy-covers.ts --write
 */
import "dotenv/config";
import mongoose from "mongoose";
import { ArticleModel } from "../src/models/article.model";
import { UpdateModel } from "../src/models/update.model";

const WRITE = process.argv.includes("--write");

function coverDe(doc: { photo?: string; blocks?: { kind?: string; assetKind?: string; assetUrl?: string; html?: string }[] }) {
  const photo = String(doc.photo || "");
  if (photo && !photo.startsWith("data:")) return photo;

  for (const block of doc.blocks || []) {
    if (block.kind === "media" && block.assetKind === "image" && block.assetUrl) {
      const url = String(block.assetUrl);
      if (!url.startsWith("data:")) return url;
    }

    const dentro = String(block.html || "").match(/<img\b[^>]*src=["'](https?:[^"']+)["']/i);
    if (dentro?.[1]) return dentro[1];
  }

  return "";
}

async function main() {
  await mongoose.connect(process.env.DB_URI as string);
  console.log(WRITE ? "ESCRITURA REAL\n" : "SIMULACRO (no escribe)\n");

  for (const [label, model] of [["reportajes", ArticleModel], ["actualizaciones", UpdateModel]] as const) {
    const docs = await (model as never as typeof ArticleModel)
      .find({ $or: [{ coverUrl: { $exists: false } }, { coverUrl: "" }] })
      .select("photo blocks");

    let con = 0;
    let sin = 0;

    for (const doc of docs) {
      const cover = coverDe(doc.toObject() as never);
      if (!cover) {
        sin++;
        continue;
      }

      con++;
      if (WRITE) {
        // Por el driver crudo: no hace falta revalidar el documento entero.
        await (model as never as typeof ArticleModel).collection.updateOne(
          { _id: doc._id },
          { $set: { coverUrl: cover } },
        );
      }
    }

    console.log(`${label}: ${con} con portada · ${sin} sin imagen (de ${docs.length} revisadas)`);
  }

  if (!WRITE) console.log("\n--- No se escribió nada. Repite con --write. ---");
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error("Falló:", error.message);
  process.exit(1);
});

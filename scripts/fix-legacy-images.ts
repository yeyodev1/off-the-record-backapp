/**
 * Quita las imágenes que quedaron duplicadas dentro del HTML de los bloques.
 *
 * La conversión extraía cada imagen a su propio bloque `media` pero la dejaba
 * también en el `html` del párrafo. Resultado: se pintaba dos veces, y la copia
 * de dentro del texto iba sin límite de tamaño.
 *
 *   pnpm ts-node scripts/fix-legacy-images.ts            ← simulacro
 *   pnpm ts-node scripts/fix-legacy-images.ts --write
 */
import "dotenv/config";
import mongoose from "mongoose";
import { ArticleModel } from "../src/models/article.model";
import { UpdateModel } from "../src/models/update.model";

const WRITE = process.argv.includes("--write");

function stripImages(html: string) {
  return String(html || "")
    .replace(/<img\b[^>]*>/gi, "")
    .replace(/<(strong|em|b|i|span)\b[^>]*>\s*<\/\1>/gi, "")
    .trim();
}

async function main() {
  await mongoose.connect(process.env.DB_URI as string);
  console.log(WRITE ? "ESCRITURA REAL\n" : "SIMULACRO (no escribe)\n");

  let totalPiezas = 0;
  let totalBloques = 0;

  for (const [label, model] of [["reportajes", ArticleModel], ["actualizaciones", UpdateModel]] as const) {
    const docs = await (model as never as typeof ArticleModel)
      .find({ legacyId: { $exists: true, $nin: ["", null] } })
      .select("blocks legacyId");

    let piezas = 0;
    let bloques = 0;

    for (const doc of docs) {
      let tocado = false;

      for (const block of doc.blocks || []) {
        const html = String(block.html || "");
        if (!/<img\b/i.test(html)) continue;

        const limpio = stripImages(html);
        // Si el bloque era solo la imagen, se queda vacío: lo marca el filtro de abajo.
        block.html = limpio;
        bloques++;
        tocado = true;
      }

      if (!tocado) continue;

      // Un párrafo que solo contenía la imagen ya no aporta nada.
      const antes = doc.blocks.length;
      doc.blocks = doc.blocks.filter(
        (block) => block.kind !== "paragraph" || String(block.html || "").length || String(block.text || "").length,
      ) as never;
      const quitados = antes - doc.blocks.length;

      piezas++;
      if (WRITE) await doc.save();
      if (quitados && piezas <= 3) console.log(`   ${doc.legacyId}: ${quitados} bloque(s) vacío(s) eliminado(s)`);
    }

    console.log(`${label}: ${piezas} piezas tocadas · ${bloques} bloques limpiados (de ${docs.length} migradas)`);
    totalPiezas += piezas;
    totalBloques += bloques;
  }

  console.log(`\ntotal: ${totalPiezas} piezas · ${totalBloques} bloques`);
  if (!WRITE) console.log("--- No se escribió nada. Repite con --write. ---");

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error("Falló:", error.message);
  process.exit(1);
});

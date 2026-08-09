/**
 * Quita los bloques de imagen que en realidad eran adornos.
 *
 * El maquetador viejo incrustaba glifos, viñetas y líneas separadoras como
 * imágenes dentro del texto. Al migrarlos como bloques de cuerpo se estiran a
 * pantalla completa: una viñeta de 20 px acaba ocupando 600 px de alto.
 *
 * Mide cada imagen bajando solo su cabecera (no la imagen entera) y descarta
 * las que son pequeñas o muy alargadas.
 *
 *   pnpm ts-node scripts/fix-legacy-decorations.ts            ← simulacro
 *   pnpm ts-node scripts/fix-legacy-decorations.ts --write
 */
import "dotenv/config";
import mongoose from "mongoose";
import { ArticleModel } from "../src/models/article.model";
import { UpdateModel } from "../src/models/update.model";
import { imageSize, isDecorative, type ImageSize } from "../src/utils/imageSize";

const WRITE = process.argv.includes("--write");

/** Cache por URL: la misma viñeta aparece en cientos de piezas. */
const medidas = new Map<string, ImageSize | null>();

async function medir(url: string): Promise<ImageSize | null> {
  if (medidas.has(url)) return medidas.get(url) as ImageSize | null;

  let size: ImageSize | null = null;
  try {
    // Solo la cabecera: con 64 KB basta para PNG, GIF, WebP y casi todo JPEG.
    const response = await fetch(url, {
      headers: { range: "bytes=0-65535" },
      signal: AbortSignal.timeout(20000),
    });

    if (response.ok || response.status === 206) {
      size = imageSize(Buffer.from(await response.arrayBuffer()));
    }
  } catch {
    // Si no se puede medir se deja como está: nunca borrar a ciegas.
  }

  medidas.set(url, size);
  return size;
}

async function main() {
  await mongoose.connect(process.env.DB_URI as string);
  console.log(WRITE ? "ESCRITURA REAL\n" : "SIMULACRO (no escribe)\n");

  let piezasTocadas = 0;
  let bloquesFuera = 0;
  let sinMedir = 0;

  for (const [label, model] of [["reportajes", ArticleModel], ["actualizaciones", UpdateModel]] as const) {
    const docs = await (model as never as typeof ArticleModel)
      .find({ legacyId: { $exists: true, $nin: ["", null] }, "blocks.kind": "media" })
      .select("blocks legacyId title");

    let piezas = 0;

    for (const doc of docs) {
      const conservar: unknown[] = [];
      let fuera = 0;

      for (const block of doc.blocks || []) {
        if (block.kind !== "media" || !block.assetUrl) {
          conservar.push(block);
          continue;
        }

        const size = await medir(String(block.assetUrl));
        if (!size) sinMedir++;

        if (isDecorative(size)) {
          fuera++;
          continue;
        }

        conservar.push(block);
      }

      if (!fuera) continue;

      piezas++;
      bloquesFuera += fuera;
      doc.blocks = conservar as never;
      if (WRITE) await doc.save();

      if (piezas <= 4) console.log(`   ${doc.legacyId}: −${fuera} adorno(s) · ${String(doc.title).slice(0, 46)}`);
    }

    console.log(`${label}: ${piezas} piezas tocadas de ${docs.length} con imágenes`);
    piezasTocadas += piezas;
  }

  const adornos = [...medidas.entries()].filter(([, size]) => isDecorative(size));
  console.log(`\nimágenes distintas medidas : ${medidas.size}`);
  console.log(`de ellas, adornos          : ${adornos.length}`);
  console.log(`no se pudieron medir       : ${sinMedir}`);
  console.log(`bloques eliminados         : ${bloquesFuera} en ${piezasTocadas} piezas`);

  console.log("\nEjemplos de lo descartado:");
  for (const [url, size] of adornos.slice(0, 6)) {
    console.log(`  ${String(size?.width).padStart(5)}×${String(size?.height).padEnd(5)} ${url.slice(-42)}`);
  }

  if (!WRITE) console.log("\n--- No se escribió nada. Repite con --write. ---");
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error("Falló:", error.message);
  process.exit(1);
});

/**
 * Notificaciones y lecturas del sistema viejo → el nuevo.
 *
 *   OTR_OLD_TOKEN="<jwt>" pnpm ts-node scripts/migrate-otradmin-extras.ts            ← simulacro
 *   OTR_OLD_TOKEN="<jwt>" pnpm ts-node scripts/migrate-otradmin-extras.ts --write
 *
 * Va **después** de migrate-otradmin.ts y migrate-otradmin-users.ts: cada
 * lectura y cada aviso apunta a un reportaje, una exclusiva o una persona, y
 * se enlazan por su `legacyId`. Lo que no encuentra pareja se cuenta y se salta.
 *
 * Los modelos no declaran `legacyId`, así que se escribe por el driver crudo
 * (Mongoose lo descartaría). Eso mismo hace la migración repetible.
 */
import "dotenv/config";
import mongoose from "mongoose";
import { ArticleModel } from "../src/models/article.model";
import { UpdateModel } from "../src/models/update.model";
import { UserModel } from "../src/models/user.model";
import { NotificationModel } from "../src/models/notification.model";
import { ReadEventModel } from "../src/models/readEvent.model";

const BASE = "https://api.otradmin.com";
const TOKEN = process.env.OTR_OLD_TOKEN || "";
const WRITE = process.argv.includes("--write");
/** Rango amplio: la API exige fechas y el sistema arrancó en 2023. */
const DESDE = "2023-01-01 00:59";
const HASTA = "2030-12-31 23:59";

type AnyRecord = Record<string, any>;

async function old<T = AnyRecord>(path: string): Promise<T> {
  const response = await fetch(BASE + path, {
    headers: { Authorization: TOKEN, accept: "application/json" },
    signal: AbortSignal.timeout(300000),
  });

  const text = await response.text();
  if (!response.ok) throw new Error(`${path} → ${response.status} ${text.slice(0, 140)}`);
  return JSON.parse(text) as T;
}

/** legacyId → documento nuevo, cargado una sola vez. */
async function indice(model: typeof ArticleModel, prefijo: string) {
  const docs = await model
    .find({ legacyId: new RegExp(`^${prefijo}:`) })
    .select("_id legacyId title categoryId categoryName")
    .lean();
  return new Map(docs.map((doc) => [String(doc.legacyId), doc]));
}

async function main() {
  if (!TOKEN) {
    console.error('Falta OTR_OLD_TOKEN. Ejecuta: OTR_OLD_TOKEN="<jwt>" pnpm ts-node scripts/migrate-otradmin-extras.ts');
    process.exit(1);
  }

  console.log(`Modo: ${WRITE ? "ESCRITURA REAL" : "SIMULACRO (no escribe nada)"}\n`);
  await mongoose.connect(process.env.DB_URI as string);

  const articulos = await indice(ArticleModel, "article");
  const exclusivas = await indice(UpdateModel as never, "update");
  const personas = new Map(
    (await UserModel.find({ legacyId: /^user:/ }).select("_id legacyId name lastname email roleId").lean()).map(
      (user) => [String(user.legacyId), user],
    ),
  );
  console.log(`En la base nueva: ${articulos.size} reportajes · ${exclusivas.size} exclusivas · ${personas.size} personas`);

  /* Lecturas ------------------------------------------------------- */

  const lecturas = [
    { tipo: "article" as const, filas: (await old(`/logs?articleId=0&userId=0&start=${encodeURIComponent(DESDE)}&end=${encodeURIComponent(HASTA)}`)).data as AnyRecord[] },
    { tipo: "update" as const, filas: (await old(`/logexclusives?exclusiveId=0&userId=0&start=${encodeURIComponent(DESDE)}&end=${encodeURIComponent(HASTA)}`)).data as AnyRecord[] },
  ];

  const tocados = { article: new Set<string>(), update: new Set<string>() };

  for (const { tipo, filas } of lecturas) {
    const resumen = { vistas: filas.length, nuevas: 0, yaEstaban: 0, sinContenido: 0, sinPersona: 0 };
    const prefijo = tipo === "article" ? "log" : "logex";
    const destino = tipo === "article" ? articulos : exclusivas;

    const existentes = new Set(
      (await ReadEventModel.collection.find({ legacyId: new RegExp(`^${prefijo}:`) }).project({ legacyId: 1 }).toArray()).map(
        (row) => String(row.legacyId),
      ),
    );

    const lote: AnyRecord[] = [];
    for (const fila of filas) {
      const legacyId = `${prefijo}:${fila.id}`;
      if (existentes.has(legacyId)) {
        resumen.yaEstaban++;
        continue;
      }

      const viejoId = tipo === "article" ? fila.articleId : fila.exclusiveId;
      const doc = destino.get(`${tipo}:${viejoId}`);
      if (!doc) {
        resumen.sinContenido++;
        continue;
      }

      const persona = personas.get(`user:${fila.userId}`);
      if (!persona) resumen.sinPersona++;

      const fecha = new Date(fila.date || fila.createdAt);
      lote.push({
        targetType: tipo,
        targetId: String(doc._id),
        targetTitle: doc.title,
        categoryId: doc.categoryId || "",
        categoryName: doc.categoryName || "",
        userId: persona ? String(persona._id) : "",
        userName: persona ? [persona.name, persona.lastname].filter(Boolean).join(" ").trim() : "",
        userEmail: persona?.email || String(fila.user?.email || ""),
        roleId: persona?.roleId || 0,
        channel: "app",
        seconds: 0,
        completed: false,
        ip: "",
        userAgent: "",
        readAt: fecha,
        createdAt: fecha,
        updatedAt: fecha,
        legacyId,
      });
      tocados[tipo].add(String(doc._id));
    }

    resumen.nuevas = lote.length;
    if (WRITE && lote.length) {
      for (let i = 0; i < lote.length; i += 1000) {
        await ReadEventModel.collection.insertMany(lote.slice(i, i + 1000), { ordered: false });
      }
    }

    console.log(`\nLECTURAS de ${tipo === "article" ? "reportajes" : "exclusivas"}`);
    console.log(`  en el viejo        : ${resumen.vistas}`);
    console.log(`  nuevas             : ${resumen.nuevas}`);
    console.log(`  ya estaban         : ${resumen.yaEstaban}`);
    console.log(`  sin pieza migrada  : ${resumen.sinContenido}`);
    console.log(`  sin persona        : ${resumen.sinPersona}`);
  }

  /* Contadores: se recalculan desde los eventos, viejos y nuevos ---- */

  if (WRITE) {
    for (const tipo of ["article", "update"] as const) {
      const model = (tipo === "article" ? ArticleModel : UpdateModel) as typeof ArticleModel;
      const ids = [...tocados[tipo]];
      const agregados = await ReadEventModel.aggregate([
        { $match: { targetType: tipo, targetId: { $in: ids } } },
        {
          $group: {
            _id: "$targetId",
            views: { $sum: 1 },
            personas: { $addToSet: "$userId" },
            lastReadAt: { $max: "$readAt" },
          },
        },
      ]);

      for (const fila of agregados) {
        await model.collection.updateOne(
          { _id: new mongoose.Types.ObjectId(String(fila._id)) },
          {
            $set: {
              "stats.views": fila.views,
              "stats.uniqueViews": fila.personas.filter(Boolean).length,
              "stats.lastReadAt": fila.lastReadAt,
            },
          },
        );
      }
      console.log(`  contadores recalculados en ${agregados.length} ${tipo === "article" ? "reportajes" : "exclusivas"}`);
    }

    const porPersona = await ReadEventModel.aggregate([
      { $match: { userId: { $ne: "" } } },
      { $group: { _id: "$userId", n: { $sum: 1 } } },
    ]);
    for (const fila of porPersona) {
      await UserModel.collection.updateOne(
        { _id: new mongoose.Types.ObjectId(String(fila._id)) },
        { $set: { readCount: fila.n } },
      );
    }
    console.log(`  lecturas por persona recalculadas: ${porPersona.length}`);
  }

  /* Notificaciones ------------------------------------------------- */

  const avisos = ((await old("/notifications")).data || []) as AnyRecord[];
  const yaAvisos = new Set(
    (await NotificationModel.collection.find({ legacyId: /^notification:/ }).project({ legacyId: 1 }).toArray()).map(
      (row) => String(row.legacyId),
    ),
  );

  const resumen = { vistas: avisos.length, nuevas: 0, yaEstaban: 0, sinPieza: 0 };
  const lote: AnyRecord[] = [];

  for (const aviso of avisos) {
    const legacyId = `notification:${aviso.id}`;
    if (yaAvisos.has(legacyId)) {
      resumen.yaEstaban++;
      continue;
    }

    const pieza = aviso.articleId ? articulos.get(`article:${aviso.articleId}`) : null;
    if (aviso.articleId && !pieza) resumen.sinPieza++;

    const autor = personas.get(`user:${aviso.userId}`);
    const destinatarios = ((aviso.users || []) as AnyRecord[])
      .map((user) => personas.get(`user:${user.id}`))
      .filter(Boolean)
      .map((user) => String(user!._id));

    const fecha = new Date(aviso.date || aviso.createdAt);
    const mensaje = String(aviso.message || "").trim() || "Notificación";

    lote.push({
      title: mensaje.length > 120 ? `${mensaje.slice(0, 117)}…` : mensaje,
      message: mensaje,
      channel: "app",
      channels: ["app"],
      trigger: "manual",
      audience: destinatarios.length ? "users" : "all",
      roleId: null,
      categoryId: "",
      userIds: destinatarios,
      targetType: pieza ? "article" : "none",
      targetId: pieza ? String(pieza._id) : "",
      link: "",
      // Ya salieron en su día: quedan como enviadas y no se reenvían.
      status: "sent",
      scheduledFor: null,
      sentAt: fecha,
      deliveredCount: destinatarios.length,
      delivery: { attempted: destinatarios.length, succeeded: destinatarios.length, failed: 0, errors: [] },
      readBy: [],
      error: "",
      createdBy: autor ? String(autor._id) : "",
      createdByName: autor ? [autor.name, autor.lastname].filter(Boolean).join(" ").trim() : "",
      createdAt: fecha,
      updatedAt: fecha,
      legacyId,
    });
  }

  resumen.nuevas = lote.length;
  if (WRITE && lote.length) await NotificationModel.collection.insertMany(lote, { ordered: false });

  console.log("\nNOTIFICACIONES");
  console.log(`  en el viejo           : ${resumen.vistas}`);
  console.log(`  nuevas                : ${resumen.nuevas}`);
  console.log(`  ya estaban            : ${resumen.yaEstaban}`);
  console.log(`  pieza sin migrar      : ${resumen.sinPieza} (se guardan sin enlace)`);

  if (!WRITE) console.log("\n--- No se escribió nada. Repite con --write. ---");
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error("\nFalló:", error.message);
  process.exit(1);
});

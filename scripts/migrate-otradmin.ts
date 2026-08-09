/**
 * Traslado del sistema viejo (api.otradmin.com) al nuevo.
 *
 *   OTR_OLD_TOKEN="<jwt>" pnpm ts-node scripts/migrate-otradmin.ts                 ← simulacro
 *   OTR_OLD_TOKEN="<jwt>" pnpm ts-node scripts/migrate-otradmin.ts --write         ← escribe
 *   ... --year 2026 · --limit 20 · --kind article|exclusive|both · --page-size 25
 *
 * Tres cosas que hay que saber de la API vieja:
 *
 * 1. Autentica con la cabecera `Authorization` y el JWT **crudo**, sin `Bearer`.
 * 2. La ruta paginada es `/articles-page/{LÍMITE}/{PÁGINA}` — el límite va
 *    primero. Invertirlos devuelve resultados plausibles pero equivocados.
 * 3. **Las imágenes vienen en base64 dentro del HTML.** Un reportaje pesa 3 MB
 *    de mediana y hasta 9 MB. Copiarlos tal cual es imposible: MongoDB corta
 *    en 16 MB por documento. Por eso cada imagen se extrae, se sube a
 *    Cloudinary y en el bloque queda su URL.
 */
import "dotenv/config";
import { createHash, randomBytes } from "crypto";
import { writeFileSync } from "fs";
import { join } from "path";
import mongoose from "mongoose";
import { ArticleModel } from "../src/models/article.model";
import { UpdateModel } from "../src/models/update.model";
import { CategoryModel } from "../src/models/category.model";
import { UserModel } from "../src/models/user.model";
import { ADMIN_ROLE_ID, EDITOR_ROLE_ID } from "../src/middlewares/role.middleware";
import { cloudinary, isCloudinaryConfigured } from "../src/config/cloudinary";
import { blocksToText, countWords, readingMinutes, slugify } from "../src/services/content.service";
import { resolveTags } from "../src/services/tag.service";
import { imageSize, isDecorative } from "../src/utils/imageSize";

const BASE = "https://api.otradmin.com";

/**
 * El acceso dura ~6 h y el traslado completo tarda más, así que se renueva
 * solo. El cliente viejo no lo hace (caduca y te echa), pero la API sí expone
 * `POST /refresh-access-token` con `{refreshToken}` — el de refresco dura 30
 * días. Sin esto la migración se moría a mitad.
 */
let TOKEN = process.env.OTR_OLD_TOKEN || "";
const REFRESH = process.env.OTR_OLD_REFRESH || "";

function expiraEn(jwt: string) {
  try {
    const { exp } = JSON.parse(Buffer.from(jwt.split(".")[1] as string, "base64").toString());
    return Math.round((exp - Date.now() / 1000) / 60);
  } catch {
    return 0;
  }
}

async function renovarSiHaceFalta() {
  // Sin token de acceso pero con refresco: se pide uno de entrada.
  if (!REFRESH || (TOKEN && expiraEn(TOKEN) > 10)) return;

  const response = await fetch(`${BASE}/refresh-access-token`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: REFRESH },
    body: JSON.stringify({ refreshToken: REFRESH }),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) throw new Error(`No se pudo renovar el acceso: ${response.status}`);

  const body = (await response.json()) as { accessToken?: string };
  if (!body.accessToken) throw new Error("La renovación no devolvió accessToken");

  TOKEN = body.accessToken;
  console.log(`   token renovado · válido ${expiraEn(TOKEN)} min más`);
}

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};

const WRITE = flag("write");
const YEAR = Number(value("year")) || null;
const LIMIT = Number(value("limit")) || 0;
const PAGE_SIZE = Number(value("page-size")) || 20;
const KIND = value("kind") || "article";
/** Meses hacia atrás desde hoy. Corta la descarga en seco al cruzar el límite. */
const SINCE_MONTHS = Number(value("since-months")) || 0;

const CORTE = (() => {
  if (!SINCE_MONTHS) return null;
  const fecha = new Date();
  fecha.setMonth(fecha.getMonth() - SINCE_MONTHS);
  return fecha;
})();

type AnyRecord = Record<string, any>;

/* ------------------------------------------------------------------ */
/* Cliente                                                             */
/* ------------------------------------------------------------------ */

async function old<T = AnyRecord>(path: string): Promise<T> {
  await renovarSiHaceFalta();

  const response = await fetch(BASE + path, {
    headers: { Authorization: TOKEN, accept: "application/json" },
    // Las páginas con base64 pesan decenas de MB: hace falta paciencia.
    signal: AbortSignal.timeout(300000),
  });

  const text = await response.text();
  if (!response.ok) throw new Error(`${path} → ${response.status} ${text.slice(0, 140)}`);

  return JSON.parse(text) as T;
}

/* ------------------------------------------------------------------ */
/* Imágenes: base64 → Cloudinary                                       */
/* ------------------------------------------------------------------ */

/** Muchas piezas repiten el mismo logo o firma: se sube una sola vez. */
const uploadCache = new Map<string, string>();
/** URLs que corresponden a adornos: no deben convertirse en bloque de imagen. */
const decorativas = new Set<string>();
const uploadStats = { uploaded: 0, reused: 0, failed: 0, bytes: 0, seen: 0, adornos: 0 };

async function uploadDataUri(dataUri: string): Promise<string> {
  uploadStats.seen++;
  const hash = createHash("sha1").update(dataUri).digest("hex");

  const cached = uploadCache.get(hash);
  if (cached !== undefined) {
    uploadStats.reused++;
    return cached;
  }

  if (!WRITE || !isCloudinaryConfigured()) {
    // En simulacro no se sube nada, pero sí se mide para saber cuánto es adorno.
    const base64 = dataUri.slice(dataUri.indexOf(",") + 1);
    if (isDecorative(imageSize(Buffer.from(base64, "base64")))) uploadStats.adornos++;

    uploadCache.set(hash, `pendiente:${hash.slice(0, 10)}`);
    return `pendiente:${hash.slice(0, 10)}`;
  }

  try {
    const result = await cloudinary.uploader.upload(dataUri, {
      folder: "otr/migracion",
      public_id: hash.slice(0, 24),
      overwrite: false,
      resource_type: "image",
    });

    uploadStats.uploaded++;
    uploadStats.bytes += result.bytes || 0;

    // Cloudinary devuelve el tamaño: un glifo o una línea no es contenido.
    if (isDecorative({ width: result.width || 0, height: result.height || 0 })) {
      decorativas.add(result.secure_url);
      uploadStats.adornos++;
    }

    uploadCache.set(hash, result.secure_url);
    return result.secure_url;
  } catch (error) {
    uploadStats.failed++;
    console.log(`      ! imagen no subida: ${(error as Error).message.slice(0, 70)}`);
    uploadCache.set(hash, "");
    return "";
  }
}

/** Sustituye cada `src="data:image/..."` por la URL ya alojada. */
async function externalizeImages(html: string): Promise<string> {
  const matches = [...html.matchAll(/src="(data:image\/[a-z+]+;base64,[^"]+)"/gi)];
  if (!matches.length) return html;

  let output = html;
  for (const match of matches) {
    const url = await uploadDataUri(match[1] as string);
    // Si falla la subida se quita la imagen: mejor sin ella que con 2 MB dentro.
    output = output.replace(match[0] as string, url ? `src="${url}"` : 'src=""');
  }

  return output;
}

/* ------------------------------------------------------------------ */
/* Quill (HTML) → bloques                                              */
/* ------------------------------------------------------------------ */

let uidSeed = 0;
const uid = () => `mig-${Date.now().toString(36)}-${(uidSeed++).toString(36)}`;

const ALIGNS: Record<string, string> = {
  "ql-align-center": "center",
  "ql-align-right": "right",
  "ql-align-justify": "justify",
};

function decode(html: string) {
  return html
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripTags(html: string) {
  return decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

/**
 * Quita las etiquetas de imagen del HTML que se queda dentro del bloque.
 * La imagen ya se extrajo a su propio bloque `media`; si además se deja aquí
 * se pinta dos veces, y la copia de dentro del texto va sin límite de tamaño.
 */
function stripImages(html: string) {
  return html
    .replace(/<img\b[^>]*>/gi, "")
    // Un <strong>/<em> que solo envolvía la imagen queda vacío: sobra.
    .replace(/<(strong|em|b|i|span)\b[^>]*>\s*<\/\1>/gi, "")
    .trim();
}

/**
 * Parte solo la estructura de primer nivel: el formato en línea
 * (`<strong>`, `<em>`, `<a>`) se conserva dentro de cada bloque.
 */
export function htmlToBlocks(html: string): AnyRecord[] {
  const source = String(html || "").trim();
  if (!source) return [];

  const blocks: AnyRecord[] = [];
  const pattern =
    /<(p|h[1-6]|ul|ol|blockquote|figure)\b([^>]*)>([\s\S]*?)<\/\1>|<(hr|img|iframe)\b([^>]*?)\/?>/gi;

  let match: RegExpExecArray | null;
  let matchedAny = false;

  while ((match = pattern.exec(source))) {
    matchedAny = true;
    const tag = (match[1] || match[4] || "").toLowerCase();
    const attrs = match[2] || match[5] || "";
    const inner = match[3] || "";

    const align = Object.entries(ALIGNS).find(([cls]) => attrs.includes(cls))?.[1] || "left";
    const indent = Number(attrs.match(/ql-indent-(\d)/)?.[1] || 0);
    const base = { align, indent, lineHeight: 1.7 };

    if (tag === "hr") {
      blocks.push({ ...base, uid: uid(), kind: "divider" });
      continue;
    }

    if (tag === "img" || tag === "iframe" || tag === "figure") {
      const src = (attrs + inner).match(/src=["']([^"']*)["']/i)?.[1] || "";
      if (!src) continue;
      blocks.push(
        tag === "iframe"
          ? { ...base, uid: uid(), kind: "embed", assetUrl: src }
          : { ...base, uid: uid(), kind: "media", assetKind: "image", assetUrl: src },
      );
      continue;
    }

    if (/^h[1-6]$/.test(tag)) {
      // Una cabecera de Quill puede llevar dentro la imagen de portada.
      const img = inner.match(/<img\b[^>]*src=["']([^"']*)["']/i)?.[1];
      if (img) blocks.push({ ...base, uid: uid(), kind: "media", assetKind: "image", assetUrl: img });

      const text = stripTags(inner);
      if (!text) continue;

      const level = Number(tag[1]);
      blocks.push({
        ...base,
        uid: uid(),
        kind: level <= 2 ? "heading" : "intertitle",
        level,
        html: stripImages(inner),
        text,
      });
      continue;
    }

    if (tag === "ul" || tag === "ol") {
      const items = [...inner.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)]
        .map((li) => stripTags(li[1] as string))
        .filter(Boolean);
      if (items.length) blocks.push({ ...base, uid: uid(), kind: "list", ordered: tag === "ol", items });
      continue;
    }

    if (tag === "blockquote") {
      blocks.push({ ...base, uid: uid(), kind: "quote", html: stripImages(inner), text: stripTags(inner) });
      continue;
    }

    // Párrafo: puede traer una imagen suelta además del texto.
    const img = inner.match(/<img\b[^>]*src=["']([^"']*)["']/i)?.[1];
    if (img) blocks.push({ ...base, uid: uid(), kind: "media", assetKind: "image", assetUrl: img });

    const text = stripTags(inner);
    if (!text) continue;
    blocks.push({ ...base, uid: uid(), kind: "paragraph", html: stripImages(inner), text });
  }

  if (!matchedAny) {
    for (const line of decode(source).split(/\n{2,}|<br\s*\/?>/i)) {
      const text = stripTags(line);
      if (text) blocks.push({ uid: uid(), kind: "paragraph", align: "left", indent: 0, lineHeight: 1.7, html: text, text });
    }
  }

  return blocks;
}

/* ------------------------------------------------------------------ */
/* Conversión                                                          */
/* ------------------------------------------------------------------ */

const categoryCache = new Map<string, { id: string; name: string; color: string }>();
const authorCache = new Map<number, { id: string; name: string }>();

/**
 * Cada reportaje necesita un autor. Se recrean los redactores del sistema
 * viejo para no perder las firmas, pero **desactivados y con contraseña
 * aleatoria**: la migración conserva el crédito, no reparte accesos. El
 * administrador los activa a mano cuando quiera.
 */
async function ensureAuthor(row: AnyRecord, fallbackId: string) {
  const legacyUserId = Number(row.userId || row.user?.id) || 0;
  if (!legacyUserId) return { id: fallbackId, name: "Migración" };

  const cached = authorCache.get(legacyUserId);
  if (cached) return cached;

  const name = String(row.user?.name || "Redactor").trim();
  const lastname = String(row.user?.lastname || "").trim();
  const email = `legacy-${legacyUserId}@otradmin.local`;

  let user = await UserModel.findOne({ email });
  if (!user) {
    user = await UserModel.create({
      name,
      lastname,
      email,
      password: randomBytes(24).toString("hex"),
      active: false,
      roleId: EDITOR_ROLE_ID,
      position: "Redactor (migrado)",
      organization: "Off The Record",
      notes: `Importado de otradmin, usuario ${legacyUserId}.`,
    });
  }

  const entry = { id: String(user._id), name: [name, lastname].filter(Boolean).join(" ") };
  authorCache.set(legacyUserId, entry);
  return entry;
}

/** Las categorías del viejo (`type`) se reusan por nombre o se crean. */
async function ensureCategory(name: string) {
  const clean = String(name || "").trim();
  if (!clean) return null;

  const cached = categoryCache.get(clean.toLowerCase());
  if (cached) return cached;

  let category = await CategoryModel.findOne({ name: clean, scope: "content" });
  if (!category) {
    category = await CategoryModel.create({
      name: clean,
      slug: slugify(clean),
      scope: "content",
      color: "#C8392B",
      icon: "fa-solid fa-layer-group",
      active: true,
    });
  }

  const entry = { id: String(category._id), name: category.name, color: category.color };
  categoryCache.set(clean.toLowerCase(), entry);
  return entry;
}

/** El campo `key` del viejo son etiquetas separadas por coma. */
function parseKeys(key: unknown) {
  return String(key || "")
    .split(/[,;]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 1)
    .slice(0, 12);
}

async function convert(row: AnyRecord, kind: "article" | "update", fallbackAuthorId: string) {
  const rawBody = String(row.description || "");
  const body = WRITE ? await externalizeImages(rawBody) : rawBody;
  const blocks = htmlToBlocks(body).filter(
    (block) => !(block.kind === "media" && decorativas.has(String(block.assetUrl))),
  );

  // En simulacro solo se cuentan las imágenes, sin subirlas.
  if (!WRITE) {
    for (const match of rawBody.matchAll(/src="data:image\/[a-z+]+;base64,[^"]+"/gi)) {
      void match;
      uploadStats.seen++;
    }
  }

  const plain = blocksToText(blocks);
  const words = countWords(plain);

  // Cuidado con el campo `date`: en los reportajes es la fecha real (verificado
  // contra 60 piezas), pero en las exclusivas viene siempre 31 días por delante
  // de `createdAt` — es una caducidad, no una publicación. Usarla dejaría todo
  // el archivo fechado en el futuro.
  const raw = kind === "article" ? row.date || row.createdAt : row.createdAt || row.date;
  const date = raw ? new Date(raw) : null;
  const published = date && !Number.isNaN(date.getTime()) ? date : null;

  const category = WRITE ? await ensureCategory(row.type?.name) : null;
  const author = WRITE ? await ensureAuthor(row, fallbackAuthorId) : { id: "", name: "" };
  const rawTags = parseKeys(row.key);
  const tags =
    WRITE && rawTags.length ? await resolveTags(rawTags, undefined) : { names: rawTags, slugs: [] as string[] };

  let photo = String(row.photo || "");
  if (WRITE && photo.startsWith("data:")) photo = await uploadDataUri(photo);

  return {
    title: String(row.title || "Sin título").trim(),
    summary: String(row.summary || "").trim(),
    observations: String(row.observations || ""),
    photo: photo.startsWith("data:") ? "" : photo,
    blocks,
    wordCount: words,
    readingMinutes: readingMinutes(words),
    slug: slugify(String(row.title || "")),
    status: row.status === false ? "draft" : "published",
    publishedAt: published,
    accentColor: category?.color || "#C8392B",
    categoryId: category?.id || "",
    categoryName: category?.name || String(row.type?.name || ""),
    tags: tags.names,
    tagSlugs: tags.slugs,
    authorId: author.id,
    authorName: author.name || [row.user?.name, row.user?.lastname].filter(Boolean).join(" ").trim(),
    // Migrar no debe disparar avisos a los clientes.
    notifyOnPublish: false,
    legacyId: `${kind}:${row.id}`,
  };
}

/* ------------------------------------------------------------------ */

async function fetchPage(kind: "article" | "update", page: number, size: number) {
  const path = kind === "article" ? `/articles-page/${size}/${page}` : `/exclusives-page/${size}/${page}`;
  const payload = await old<AnyRecord>(path);

  return {
    rows: (payload.articles || payload.exclusives || payload.data || []) as AnyRecord[],
    total: Number(payload.contador) || 0,
  };
}

async function migrate(kind: "article" | "update", fallbackAuthorId: string) {
  const model = kind === "article" ? ArticleModel : UpdateModel;
  const label = kind === "article" ? "REPORTAJES" : "EXCLUSIVAS";

  console.log(`\n${"=".repeat(60)}\n${label}\n${"=".repeat(60)}`);

  const first = await fetchPage(kind, 1, 1);
  const total = first.total;
  const objetivo = LIMIT || total;
  const paginas = Math.max(1, Math.ceil(objetivo / PAGE_SIZE));

  console.log(`Total en el sistema viejo: ${total}`);
  console.log(`A procesar: ${objetivo} en ${paginas} páginas de ${PAGE_SIZE}`);

  const resumen = { vistos: 0, saltados: 0, creados: 0, repetidos: 0, vacios: 0, bloques: 0 };
  const muestras: AnyRecord[] = [];
  let cortado = false;

  for (let page = 1; page <= paginas; page++) {
    const inicio = Date.now();

    let lote;
    try {
      lote = await fetchPage(kind, page, PAGE_SIZE);
    } catch (error) {
      console.log(`  página ${page}: ${(error as Error).message.slice(0, 90)} — se salta`);
      continue;
    }

    if (!lote.rows.length) break;

    for (const row of lote.rows) {
      resumen.vistos++;

      const fecha = new Date(kind === "article" ? row.date || row.createdAt : row.createdAt || row.date);

      // La API devuelve de lo más nuevo a lo más viejo, así que al cruzar el
      // corte no queda nada más reciente: se para en seco en vez de seguir
      // bajando gigabytes que se van a descartar.
      if (CORTE && !Number.isNaN(fecha.getTime()) && fecha < CORTE) {
        cortado = true;
        break;
      }

      if (YEAR && fecha.getFullYear() !== YEAR) {
        resumen.saltados++;
        continue;
      }

      const legacyId = `${kind}:${row.id}`;
      if (WRITE && (await model.exists({ legacyId }))) {
        resumen.repetidos++;
        continue;
      }

      const doc = await convert(row, kind, fallbackAuthorId);
      resumen.bloques += doc.blocks.length;
      if (!doc.blocks.length) resumen.vacios++;
      if (muestras.length < 3) muestras.push(doc);

      if (WRITE) {
        const creado = await model.create(doc as never);
        resumen.creados++;

        // Mongoose sella createdAt con la hora de la migración y trata ese
        // campo como inmutable: un `updateOne` con `timestamps: false` se
        // descarta en silencio (devuelve acknowledged:false). Hay que escribir
        // por el driver crudo, o el archivo entero aparecería creado hoy.
        if (doc.publishedAt) {
          await model.collection.updateOne(
            { _id: creado._id },
            { $set: { createdAt: doc.publishedAt, updatedAt: doc.publishedAt } },
          );
        }
      }
    }

    const seg = ((Date.now() - inicio) / 1000).toFixed(0);
    console.log(
      `  página ${String(page).padStart(3)}/${paginas} · ${resumen.vistos} vistos · ` +
        `${resumen.creados} creados · ${uploadStats.uploaded} img subidas · ${seg}s`,
    );

    if (cortado) {
      console.log(`  → alcanzado el corte de ${SINCE_MONTHS} meses (${CORTE?.toISOString().slice(0, 10)}). Se detiene.`);
      break;
    }
  }

  console.log(`\n${label} — resumen`);
  console.log(`  vistos      : ${resumen.vistos}`);
  if (YEAR) console.log(`  fuera de ${YEAR}: ${resumen.saltados}`);
  console.log(`  creados     : ${resumen.creados}`);
  console.log(`  ya estaban  : ${resumen.repetidos}`);
  console.log(`  sin cuerpo  : ${resumen.vacios}`);
  console.log(`  bloques     : ${resumen.bloques}`);

  return { resumen, muestras };
}

async function main() {
  // Con el token de refresco basta: el de acceso se pide solo.
  if (!TOKEN && REFRESH) await renovarSiHaceFalta();

  if (!TOKEN) {
    console.error(
      [
        "Falta OTR_OLD_TOKEN (o OTR_OLD_REFRESH para obtenerlo solo).",
        "",
        "Entra tú en https://web.otradmin.com/admin, abre F12 → Application →",
        "Local Storage, copia el token y ejecuta:",
        '  OTR_OLD_TOKEN="<pegar>" pnpm ts-node scripts/migrate-otradmin.ts',
      ].join("\n"),
    );
    process.exit(1);
  }

  const minutos = expiraEn(TOKEN);
  if (minutos <= 0 && !REFRESH) {
    console.error("El token ya caducó y no hay OTR_OLD_REFRESH para renovarlo.");
    process.exit(1);
  }

  console.log(`Modo: ${WRITE ? "ESCRITURA REAL" : "SIMULACRO (no escribe nada)"}`);
  console.log(
    REFRESH
      ? `Token válido ${minutos} min · se renueva solo (refresco vence en ${Math.round(expiraEn(REFRESH) / 1440)} días)`
      : `Token válido ${minutos} min · SIN renovación automática`,
  );
  if (YEAR) console.log(`Filtro: solo ${YEAR}`);
  if (CORTE) console.log(`Ventana: últimos ${SINCE_MONTHS} meses (desde ${CORTE.toISOString().slice(0, 10)})`);
  if (LIMIT) console.log(`Muestra: ${LIMIT}`);

  if (WRITE) {
    if (!isCloudinaryConfigured()) {
      console.error("\nCloudinary no está configurado y las imágenes vienen en base64.");
      console.error("Sin él los reportajes quedarían sin fotos. Configura CLOUDINARY_* y repite.");
      process.exit(1);
    }
    await mongoose.connect(process.env.DB_URI as string);
  }

  const salida: AnyRecord = {};
  // Autor de reserva por si una pieza vieja no trae usuario.
  let fallbackAuthorId = "";
  if (WRITE) {
    const admin = await UserModel.findOne({ roleId: ADMIN_ROLE_ID }).select("_id");
    fallbackAuthorId = String(admin?._id || "");
    if (!fallbackAuthorId) {
      console.error("No hay ninguna cuenta de administrador en la base nueva.");
      process.exit(1);
    }
  }

  if (KIND === "article" || KIND === "both") salida.articles = await migrate("article", fallbackAuthorId);
  if (KIND === "exclusive" || KIND === "both") salida.exclusives = await migrate("update", fallbackAuthorId);

  console.log(`\n${"=".repeat(60)}\nIMÁGENES`);
  console.log(`  encontradas : ${uploadStats.seen}`);
  console.log(`  subidas     : ${uploadStats.uploaded}`);
  console.log(`  repetidas (no se resuben): ${uploadStats.reused}`);
  console.log(`  fallidas    : ${uploadStats.failed}`);
  console.log(`  adornos descartados (glifos, separadores): ${uploadStats.adornos}`);
  if (uploadStats.bytes) console.log(`  peso en Cloudinary: ${(uploadStats.bytes / 1e6).toFixed(1)} MB`);

  if (!WRITE) {
    const muestra = (salida.articles?.muestras || salida.exclusives?.muestras || [])[0];
    if (muestra) {
      console.log(`\nMuestra convertida: «${muestra.title}»`);
      console.log(`  ${muestra.blocks.length} bloques · ${muestra.wordCount} palabras · ${muestra.publishedAt}`);
      console.log(`  categoría: ${muestra.categoryName || "—"} · etiquetas: ${muestra.tags.join(", ") || "—"}`);
      for (const block of muestra.blocks.slice(0, 6)) {
        const texto = block.text || block.items?.join(", ") || block.assetUrl || "";
        console.log(`    [${String(block.kind).padEnd(10)}] ${String(texto).slice(0, 66)}`);
      }
    }

    // Las muestras llevan base64 dentro: se recortan o el informe pesa megas.
    const recortado = JSON.parse(
      JSON.stringify(salida, (key, val) =>
        key === "assetUrl" && typeof val === "string" && val.startsWith("data:")
          ? `${val.slice(0, 60)}…(${(val.length / 1024).toFixed(0)} KB de base64)`
          : val,
      ),
    );

    const reportePath = join(__dirname, "migracion-simulacro.json");
    writeFileSync(reportePath, JSON.stringify(recortado, null, 2));
    console.log(`\nInforme del simulacro: ${reportePath}`);
    console.log("--- No se escribió nada. Repite con --write cuando lo revises. ---");
  }

  if (WRITE) await mongoose.disconnect();
}

if (require.main === module) {
  main().catch((error) => {
    console.error("\nFalló la migración:", error.message);
    process.exit(1);
  });
}

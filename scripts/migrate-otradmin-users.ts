/**
 * Padrón de usuarios del sistema viejo → el nuevo.
 *
 *   OTR_OLD_REFRESH="<jwt>" pnpm ts-node scripts/migrate-otradmin-users.ts           ← simulacro
 *   OTR_OLD_REFRESH="<jwt>" pnpm ts-node scripts/migrate-otradmin-users.ts --write
 *
 * Dos cosas que hacen esto mucho mejor de lo esperado:
 *
 * 1. `GET /users` devuelve el **hash bcrypt** de cada cuenta, y ambos sistemas
 *    usan bcrypt. Se copia tal cual: **nadie tiene que cambiar su contraseña**.
 * 2. Los roles coinciden 1:1 — 1 administrador, 2 lector, 3 escritor.
 *
 * Además reconcilia los autores provisionales que creó la migración de
 * contenido (`legacy-<id>@otradmin.local`): en vez de duplicar la persona,
 * actualiza ese mismo registro con sus datos reales, así los reportajes ya
 * migrados conservan su firma.
 */
import "dotenv/config";
import mongoose from "mongoose";
import { UserModel } from "../src/models/user.model";
import { CategoryModel } from "../src/models/category.model";

const BASE = "https://api.otradmin.com";
const REFRESH = process.env.OTR_OLD_REFRESH || "";
const WRITE = process.argv.includes("--write");

type AnyRecord = Record<string, any>;

interface OldUser {
  id: number;
  name: string;
  lastname: string;
  ci: string | null;
  email: string;
  password: string;
  active: boolean;
  changepass: boolean;
  phone: string | null;
  premium: boolean;
  register: string;
  createdAt: string;
  roleId: number;
}

async function accessToken() {
  const response = await fetch(`${BASE}/refresh-access-token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken: REFRESH }),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) throw new Error(`No se pudo renovar el acceso: ${response.status}`);
  const body = (await response.json()) as { accessToken?: string };
  if (!body.accessToken) throw new Error("La renovación no devolvió accessToken");
  return body.accessToken;
}

/** Los roles son los mismos números en los dos sistemas. */
const ROLES: Record<number, string> = { 1: "Administrador", 2: "Lector", 3: "Escritor" };

async function main() {
  if (!REFRESH) {
    console.error('Falta OTR_OLD_REFRESH. Ejecuta: OTR_OLD_REFRESH="<jwt>" pnpm ts-node scripts/migrate-otradmin-users.ts');
    process.exit(1);
  }

  console.log(`Modo: ${WRITE ? "ESCRITURA REAL" : "SIMULACRO (no escribe nada)"}\n`);

  const token = await accessToken();
  const payload = (await (
    await fetch(`${BASE}/users`, { headers: { Authorization: token }, signal: AbortSignal.timeout(120000) })
  ).json()) as { users: OldUser[] };

  const users = payload.users || [];
  console.log(`Usuarios en el sistema viejo: ${users.length}`);

  const porRol = new Map<number, number>();
  let conHash = 0;
  for (const user of users) {
    porRol.set(user.roleId, (porRol.get(user.roleId) || 0) + 1);
    if (String(user.password || "").startsWith("$2")) conHash++;
  }

  console.log(
    "  por rol:",
    [...porRol.entries()].map(([id, n]) => `${ROLES[id] || id}=${n}`).join(" · "),
  );
  console.log(`  activos: ${users.filter((u) => u.active).length} · premium: ${users.filter((u) => u.premium).length}`);
  console.log(`  con hash bcrypt reutilizable: ${conHash}/${users.length}`);

  if (!WRITE) {
    console.log("\nMuestra de lo que se crearía:");
    for (const user of users.slice(0, 5)) {
      console.log(
        `  ${(user.email || "").padEnd(34)} ${(ROLES[user.roleId] || "?").padEnd(14)}` +
          ` activo=${String(user.active).padEnd(5)} premium=${user.premium}`,
      );
    }
    console.log("\n--- No se escribió nada. Repite con --write. ---");
    return;
  }

  await mongoose.connect(process.env.DB_URI as string);

  // Los lectores premium entran en el segmento de clientes premium.
  const premiumCat = await CategoryModel.findOne({ scope: "audience", name: /premium/i }).select("_id name");

  const resumen = { creados: 0, reconciliados: 0, existentes: 0, saltados: 0 };

  for (const user of users) {
    const email = String(user.email || "").trim().toLowerCase();
    if (!email) {
      resumen.saltados++;
      continue;
    }

    const datos: AnyRecord = {
      name: String(user.name || "").trim() || "Sin nombre",
      lastname: String(user.lastname || "").trim(),
      ci: String(user.ci || ""),
      email,
      // Hash bcrypt del sistema viejo: la contraseña de siempre sigue valiendo.
      password: user.password,
      active: Boolean(user.active),
      changepass: Boolean(user.changepass),
      phone: String(user.phone || ""),
      premium: Boolean(user.premium),
      roleId: Number(user.roleId) || 2,
      legacyId: `user:${user.id}`,
      notes: `Importado de otradmin (usuario ${user.id}).`,
    };

    if (user.premium && premiumCat) {
      datos.categoryIds = [String(premiumCat._id)];
      datos.categoryNames = [premiumCat.name];
    }

    // ¿Ya existe con su correo real?
    const porEmail = await UserModel.findOne({ email });
    if (porEmail) {
      resumen.existentes++;
      continue;
    }

    // ¿Existe como autor provisional de la migración de contenido?
    const provisional = await UserModel.findOne({ email: `legacy-${user.id}@otradmin.local` });
    if (provisional) {
      // Se actualiza en su sitio para que los reportajes no pierdan la firma.
      await UserModel.updateOne({ _id: provisional._id }, { $set: datos });
      resumen.reconciliados++;
      continue;
    }

    const creado = await UserModel.create(datos as never);
    resumen.creados++;

    // La fecha de alta original, por el driver crudo (Mongoose la trata como inmutable).
    const alta = new Date(user.register || user.createdAt);
    if (!Number.isNaN(alta.getTime())) {
      await UserModel.collection.updateOne({ _id: creado._id }, { $set: { createdAt: alta, register: alta } });
    }
  }

  console.log("\nResumen");
  console.log(`  creados                : ${resumen.creados}`);
  console.log(`  autores reconciliados  : ${resumen.reconciliados}`);
  console.log(`  ya existían            : ${resumen.existentes}`);
  console.log(`  sin correo (saltados)  : ${resumen.saltados}`);

  const total = await UserModel.countDocuments({});
  const migrados = await UserModel.countDocuments({ legacyId: { $exists: true, $nin: ["", null] } });
  const pendientes = await UserModel.countDocuments({ email: /@otradmin\.local$/ });
  console.log(`\nEn la base nueva: ${total} cuentas · ${migrados} migradas · ${pendientes} autores sin reconciliar`);

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error("\nFalló:", error.message);
  process.exit(1);
});

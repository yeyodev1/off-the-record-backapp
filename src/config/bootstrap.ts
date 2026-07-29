import { hashPassword } from "../utils/password";
import { UserModel } from "../models/user.model";
import { RoleModel } from "../models/role.model";
import { TypeModel } from "../models/type.model";

async function ensureRoles() {
  const roles = ["Admin", "Writer", "Reader"];

  await Promise.all(
    roles.map(async (name, index) => {
      const exists = await RoleModel.findOne({ name });
      if (!exists) {
        await RoleModel.create({ name });
      }
    }),
  );
}

async function ensureTypes() {
  const types = ["General", "Politica", "Opiniones"];

  await Promise.all(
    types.map(async (name) => {
      const exists = await TypeModel.findOne({ name });
      if (!exists) {
        await TypeModel.create({ name });
      }
    }),
  );
}

async function ensureAdminUser() {
  const hasAdmin = await UserModel.exists({ roleId: 1 });
  if (hasAdmin) return;

  const email = process.env.BOOTSTRAP_ADMIN_EMAIL || "admin@local.test";
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || "admin1234";

  await UserModel.create({
    name: "Admin",
    lastname: "Off The Record",
    email,
    password: await hashPassword(password),
    active: true,
    roleId: 1,
    changepass: false,
  });

  console.log(`Bootstrap admin ready: ${email}`);
}

async function ensureReaderUser() {
  const email = process.env.BOOTSTRAP_READER_EMAIL || "reader@local.test";
  const exists = await UserModel.exists({ email });
  if (exists) return;

  const password = process.env.BOOTSTRAP_READER_PASSWORD || "reader1234";
  await UserModel.create({
    name: "Reader",
    lastname: "Off The Record",
    email,
    password: await hashPassword(password),
    active: true,
    roleId: 2,
    changepass: false,
  });

  console.log(`Bootstrap reader ready: ${email}`);
}

export async function bootstrapData() {
  await ensureRoles();
  await ensureTypes();
  await ensureAdminUser();
  await ensureReaderUser();
}

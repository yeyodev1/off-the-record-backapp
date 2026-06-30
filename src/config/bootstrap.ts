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
  const total = await UserModel.countDocuments();
  if (total > 0) {
    return;
  }

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

export async function bootstrapData() {
  await ensureRoles();
  await ensureTypes();
  await ensureAdminUser();
}

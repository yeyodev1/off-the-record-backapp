import { hashPassword } from "../utils/password";
import { UserModel } from "../models/user.model";
import { RoleModel } from "../models/role.model";
import { TypeModel } from "../models/type.model";
import { CategoryModel } from "../models/category.model";
import { IndicatorModel } from "../models/indicator.model";
import { slugify } from "../services/content.service";
import {
  ADMIN_ROLE_ID,
  EDITOR_ROLE_ID,
  READER_ROLE_ID,
  ROLE_NAMES,
  SUPERADMIN_ROLE_ID,
} from "../middlewares/role.middleware";

/** Every seeded account uses the same password on purpose: this is a demo roster. */
const SEED_PASSWORD = "123456789";

const CONTENT_CATEGORIES = [
  { name: "Investigación", color: "#C8392B", icon: "fa-solid fa-magnifying-glass" },
  { name: "Política", color: "#7B6CF6", icon: "fa-solid fa-landmark" },
  { name: "Economía", color: "#C9A84C", icon: "fa-solid fa-chart-line" },
  { name: "Seguridad", color: "#2094D2", icon: "fa-solid fa-shield-halved" },
  { name: "Opinión", color: "#57A773", icon: "fa-solid fa-feather" },
];

const AUDIENCE_CATEGORIES = [
  { name: "Clientes premium", color: "#C9A84C", icon: "fa-solid fa-crown" },
  { name: "Suscriptores", color: "#2094D2", icon: "fa-solid fa-user-group" },
  { name: "Equipo editorial", color: "#C8392B", icon: "fa-solid fa-pen-nib" },
  { name: "Prensa aliada", color: "#7B6CF6", icon: "fa-solid fa-handshake" },
];

interface SeedUser {
  name: string;
  lastname: string;
  email: string;
  roleId: number;
  position: string;
  organization: string;
  phone: string;
  signalHandle: string;
  premium: boolean;
  audience: string[];
}

const SEED_USERS: SeedUser[] = [
  {
    name: "Sofía",
    lastname: "Valdivieso",
    email: "superadmin@offtherecord.ec",
    roleId: SUPERADMIN_ROLE_ID,
    position: "Superadministradora",
    organization: "Off The Record",
    phone: "+593 99 000 0001",
    signalHandle: "@sofia.otr",
    premium: true,
    audience: ["Equipo editorial"],
  },
  {
    name: "Andersson",
    lastname: "Boscán",
    email: "admin@offtherecord.ec",
    roleId: ADMIN_ROLE_ID,
    position: "Director editorial",
    organization: "Off The Record",
    phone: "+593 99 000 0002",
    signalHandle: "@andersson.otr",
    premium: true,
    audience: ["Equipo editorial"],
  },
  {
    name: "Mónica",
    lastname: "Velásquez",
    email: "editora@offtherecord.ec",
    roleId: EDITOR_ROLE_ID,
    position: "Editora de investigación",
    organization: "Off The Record",
    phone: "+593 99 000 0003",
    signalHandle: "@monica.otr",
    premium: false,
    audience: ["Equipo editorial"],
  },
  {
    name: "Julio",
    lastname: "Cabrera",
    email: "redactor@offtherecord.ec",
    roleId: EDITOR_ROLE_ID,
    position: "Redactor de política",
    organization: "Off The Record",
    phone: "+593 99 000 0004",
    signalHandle: "@julio.otr",
    premium: false,
    audience: ["Equipo editorial"],
  },
  {
    name: "Carolina",
    lastname: "Mendoza",
    email: "cliente.premium@offtherecord.ec",
    roleId: READER_ROLE_ID,
    position: "Directora de riesgos",
    organization: "Grupo Andina",
    phone: "+593 99 000 0005",
    signalHandle: "@carolina.andina",
    premium: true,
    audience: ["Clientes premium", "Suscriptores"],
  },
  {
    name: "Ricardo",
    lastname: "Paredes",
    email: "cliente.corporativo@offtherecord.ec",
    roleId: READER_ROLE_ID,
    position: "Gerente legal",
    organization: "Corporación Litoral",
    phone: "+593 99 000 0006",
    signalHandle: "@ricardo.litoral",
    premium: true,
    audience: ["Clientes premium"],
  },
  {
    name: "Daniela",
    lastname: "Ortiz",
    email: "suscriptor@offtherecord.ec",
    roleId: READER_ROLE_ID,
    position: "Analista política",
    organization: "Observatorio Ciudadano",
    phone: "+593 99 000 0007",
    signalHandle: "@daniela.obs",
    premium: false,
    audience: ["Suscriptores"],
  },
  {
    name: "Fernando",
    lastname: "Arteaga",
    email: "prensa@offtherecord.ec",
    roleId: READER_ROLE_ID,
    position: "Corresponsal",
    organization: "Red Prensa Sur",
    phone: "+593 99 000 0008",
    signalHandle: "@fernando.rps",
    premium: false,
    audience: ["Prensa aliada", "Suscriptores"],
  },
];

const MANUAL = { provider: "manual", symbol: "", url: "", path: "", multiplier: 1, refreshHours: 6 };

/** Todos nacen conectados a una fuente pública verificada. */
const SEED_INDICATORS = [
  {
    name: "Petróleo WTI",
    code: "WTI",
    value: 0,
    unit: "USD",
    format: "currency",
    color: "#C9A84C",
    source: "Banco Central del Ecuador",
    feed: { ...MANUAL, provider: "bce", symbol: "diarios|Precio Petróleo (WTI)", refreshHours: 6 },
  },
  {
    name: "Petróleo Brent",
    code: "BRENT",
    value: 0,
    unit: "USD",
    format: "currency",
    color: "#C8392B",
    source: "ICE",
    feed: { ...MANUAL, provider: "yahoo", symbol: "BZ=F", refreshHours: 1 },
  },
  {
    name: "Inflación anual Ecuador",
    code: "INF-EC",
    value: 0,
    unit: "",
    format: "percent",
    color: "#7B6CF6",
    source: "Banco Mundial",
    feed: { ...MANUAL, provider: "worldbank", symbol: "FP.CPI.TOTL.ZG", refreshHours: 24 },
  },
  {
    name: "Dólar / Euro",
    code: "USDEUR",
    value: 0,
    unit: "",
    format: "number",
    color: "#2094D2",
    source: "BCE europeo",
    feed: { ...MANUAL, provider: "frankfurter", symbol: "USD/EUR", refreshHours: 6 },
  },
  {
    name: "Riesgo país",
    code: "EMBI",
    value: 0,
    unit: "pb",
    format: "number",
    color: "#FF6B7A",
    source: "Banco Central del Ecuador",
    feed: { ...MANUAL, provider: "bce", symbol: "formulario|Riesgo País", refreshHours: 6 },
  },
  {
    name: "Tasa activa referencial",
    code: "TASA-ACT",
    value: 0,
    unit: "",
    format: "percent",
    color: "#57A773",
    source: "Banco Central del Ecuador",
    feed: { ...MANUAL, provider: "bce", symbol: "monetario|Tasa Activa Referencial", refreshHours: 12 },
  },
  {
    name: "Reservas internacionales",
    code: "RI",
    value: 0,
    unit: "M USD",
    format: "number",
    color: "#2094D2",
    source: "Banco Central del Ecuador",
    feed: { ...MANUAL, provider: "bce", symbol: "monetario|Reservas Internacionales", refreshHours: 12 },
  },
  {
    name: "Balanza comercial",
    code: "BC",
    value: 0,
    unit: "M USD",
    format: "number",
    color: "#7B6CF6",
    source: "Banco Central del Ecuador",
    feed: { ...MANUAL, provider: "bce", symbol: "externo|Saldo Balanza Comercial", refreshHours: 24 },
  },
  {
    name: "Remesas recibidas",
    code: "REM",
    value: 0,
    unit: "M USD",
    format: "number",
    color: "#C9A84C",
    source: "Banco Central del Ecuador",
    feed: { ...MANUAL, provider: "bce", symbol: "balanza|Remesas de Trabajadores Recibidas", refreshHours: 24 },
  },
  {
    name: "Recaudación SRI del mes",
    code: "SRI-MES",
    value: 0,
    unit: "M USD",
    format: "number",
    color: "#57A773",
    source: "Servicio de Rentas Internas",
    feed: { ...MANUAL, provider: "sri", symbol: "mes|TOTAL", refreshHours: 24 },
  },
  {
    name: "Recaudación SRI acumulada",
    code: "SRI-ACUM",
    value: 0,
    unit: "M USD",
    format: "number",
    color: "#C8392B",
    source: "Servicio de Rentas Internas",
    feed: { ...MANUAL, provider: "sri", symbol: "acumulado|TOTAL", refreshHours: 24 },
  },
];

async function ensureRoles() {
  const roles = Object.values(ROLE_NAMES);

  await Promise.all(
    roles.map((name) => RoleModel.updateOne({ name }, { $setOnInsert: { name } }, { upsert: true })),
  );
}

async function ensureTypes() {
  const types = ["General", "Politica", "Opiniones"];

  await Promise.all(
    types.map((name) => TypeModel.updateOne({ name }, { $setOnInsert: { name } }, { upsert: true })),
  );
}

async function ensureCategories() {
  const seeds = [
    ...CONTENT_CATEGORIES.map((item, index) => ({ ...item, scope: "content" as const, order: index })),
    ...AUDIENCE_CATEGORIES.map((item, index) => ({ ...item, scope: "audience" as const, order: index })),
  ];

  await Promise.all(
    seeds.map((seed) =>
      CategoryModel.updateOne(
        { name: seed.name, scope: seed.scope },
        { $setOnInsert: { ...seed, slug: slugify(seed.name), active: true } },
        { upsert: true },
      ),
    ),
  );
}

async function ensureIndicators() {
  await Promise.all(
    SEED_INDICATORS.map((seed, index) =>
      IndicatorModel.updateOne(
        { code: seed.code },
        {
          $setOnInsert: {
            ...seed,
            order: index,
            active: true,
            previousValue: null,
            history: seed.value ? [{ value: seed.value, at: new Date() }] : [],
            measuredAt: new Date(),
            lastSyncStatus: "pending",
          },
        },
        { upsert: true },
      ),
    ),
  );
}

/**
 * Seeds the working roster directly in MongoDB — no environment variables
 * involved. Existing accounts are never overwritten.
 */
async function ensureUsers() {
  const audienceCategories = await CategoryModel.find({ scope: "audience" }).select("name");
  const byName = new Map(audienceCategories.map((category) => [category.name, String(category._id)]));

  const password = await hashPassword(SEED_PASSWORD);

  for (const seed of SEED_USERS) {
    const categoryIds = seed.audience.map((name) => byName.get(name)).filter(Boolean) as string[];

    await UserModel.updateOne(
      { email: seed.email },
      {
        $setOnInsert: {
          name: seed.name,
          lastname: seed.lastname,
          email: seed.email,
          password,
          active: true,
          changepass: false,
          roleId: seed.roleId,
          position: seed.position,
          organization: seed.organization,
          phone: seed.phone,
          signalHandle: seed.signalHandle,
          premium: seed.premium,
          categoryIds,
          categoryNames: seed.audience,
        },
      },
      { upsert: true },
    );
  }

  console.log(`Roster listo: ${SEED_USERS.length} cuentas sembradas (contraseña ${SEED_PASSWORD}).`);
}

export async function bootstrapData() {
  await ensureRoles();
  await ensureTypes();
  await ensureCategories();
  await ensureIndicators();
  await ensureUsers();
}

export { SEED_USERS, SEED_PASSWORD };

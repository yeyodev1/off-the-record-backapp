/**
 * Fuentes de datos para los indicadores económicos.
 *
 * Solo se incluyen proveedores verificados que responden sin clave. El
 * proveedor `json` es el escape: permite conectar cualquier endpoint propio
 * sin tocar el código.
 */

export type IndicatorProvider = "manual" | "bce" | "sri" | "yahoo" | "worldbank" | "frankfurter" | "json";

export interface IndicatorSource {
  provider: IndicatorProvider;
  symbol?: string;
  url?: string;
  path?: string;
  multiplier?: number;
  refreshHours?: number;
}

export interface FetchedValue {
  value: number;
  measuredAt: Date;
  label: string;
}

const UA = "Mozilla/5.0 (compatible; OffTheRecord/1.0)";
const TIMEOUT_MS = 20000;

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { "user-agent": UA, accept: "application/json,text/plain,*/*" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) throw new Error(`La fuente respondió ${response.status}`);
  return (await response.json()) as T;
}

/* ------------------------------------------------------------------ */
/* Banco Central del Ecuador                                           */
/* ------------------------------------------------------------------ */

/**
 * El BCE publica los datos de su portal en archivos JSON abiertos: los mismos
 * que consume su propia web. No hay que raspar HTML.
 */
const BCE_BASE = "https://contenido.bce.fin.ec/wp-content/uploads/ESTADISTICAS-ECONOMICAS/indicadores/";

const BCE_DATASETS: Record<string, string> = {
  formulario: "datos_formulario.json",
  diarios: "datos_diarios.json",
  monetario: "datos.json",
  externo: "datos_cxt.json",
  balanza: "datos_bpa.json",
};

interface BceRow {
  Indicador?: string;
  Fecha?: string;
  Carga?: string;
  Valor?: string | number;
  Medida?: string;
  Periodicidad?: string;
}

// Los archivos pesan varios MB y sirven a muchos indicadores: los cacheamos.
const bceCache = new Map<string, { rows: BceRow[]; at: number }>();
const BCE_CACHE_MS = 10 * 60 * 1000;

/**
 * El BCE mezcla formatos: "4.341,56" (es-EC) y "77.29" (punto decimal).
 * La coma es la señal fiable de que los puntos son separador de miles.
 */
function parseBceNumber(raw: string | number | undefined): number {
  if (typeof raw === "number") return raw;

  const text = String(raw ?? "").trim();
  if (!text) return NaN;

  return Number(text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text);
}

async function loadBceDataset(dataset: string): Promise<BceRow[]> {
  const file = BCE_DATASETS[dataset];
  if (!file) throw new Error(`Conjunto del BCE desconocido: ${dataset}`);

  const cached = bceCache.get(dataset);
  if (cached && Date.now() - cached.at < BCE_CACHE_MS) return cached.rows;

  const body = await getJson<Record<string, BceRow[]>>(BCE_BASE + file);
  const rows = Object.values(body)[0] || [];

  bceCache.set(dataset, { rows, at: Date.now() });
  return rows;
}

/** El símbolo llega como "diarios|Precio Petróleo (WTI)". */
async function fromBce(symbol: string): Promise<FetchedValue> {
  const [dataset, ...rest] = symbol.split("|");
  const name = rest.join("|").trim();

  if (!dataset || !name) throw new Error('Formato esperado: "conjunto|Nombre del indicador"');

  const rows = await loadBceDataset(dataset.trim());
  const matches = rows.filter((row) => (row.Indicador || "").trim() === name);

  if (!matches.length) throw new Error(`El BCE no publica «${name}» en ese conjunto`);

  const latest = matches.reduce((best, row) =>
    new Date(row.Fecha || 0) > new Date(best.Fecha || 0) ? row : best,
  );

  const value = parseBceNumber(latest.Valor);
  if (!Number.isFinite(value)) throw new Error(`Valor ilegible para «${name}»`);

  return {
    value,
    measuredAt: latest.Fecha ? new Date(`${latest.Fecha}T12:00:00Z`) : new Date(),
    label: `${name} · ${latest.Medida || ""}`.trim(),
  };
}

/* ------------------------------------------------------------------ */
/* SRI — recaudación tributaria del Ecuador                            */
/* ------------------------------------------------------------------ */

/**
 * El SRI no expone una API, pero publica su recaudación como CSV abierto en
 * una URL con plantilla por año (sin UUID, sin token): se reemplaza en sitio
 * cada mes. El registro es a nivel de cantón e impuesto, así que el archivo
 * ronda los 50 MB y hay que agregarlo aquí.
 *
 * Se lee en streaming y solo se conservan los totales: la memoria no depende
 * del tamaño del archivo.
 */
const SRI_CSV = (year: number) =>
  `https://descargas.sri.gob.ec/download/datosAbiertos/sri_recaudacion_${year}.csv`;

interface SriTotals {
  year: number;
  /** Etiqueta tal cual la publica el SRI, p. ej. "06 Junio". */
  latestMonth: string;
  monthNumber: number;
  /** Millones de USD por grupo de impuesto; la clave "TOTAL" es la suma. */
  month: Map<string, number>;
  year_: Map<string, number>;
}

const sriCache = new Map<number, { totals: SriTotals; at: number }>();
const SRI_CACHE_MS = 6 * 60 * 60 * 1000; // el dato cambia una vez al mes
const SRI_TIMEOUT_MS = 120000; // 50 MB no bajan en 20 s

/** El CSV usa formato es-EC: "12.461,4700". */
function parseSriNumber(raw: string): number {
  const value = Number(String(raw).trim().replace(/\./g, "").replace(",", "."));
  return Number.isFinite(value) ? value : 0;
}

/**
 * Descarga y agrega el CSV sin materializarlo: acumula por mes y grupo de
 * impuesto mientras van llegando los trozos.
 */
async function loadSriTotals(year: number): Promise<SriTotals> {
  const cached = sriCache.get(year);
  if (cached && Date.now() - cached.at < SRI_CACHE_MS) return cached.totals;

  const response = await fetch(SRI_CSV(year), {
    headers: { "user-agent": UA, accept: "text/csv,*/*" },
    signal: AbortSignal.timeout(SRI_TIMEOUT_MS),
  });

  if (!response.ok) throw new Error(`El SRI respondió ${response.status} para ${year}`);
  if (!response.body) throw new Error("El SRI no devolvió contenido");

  // Los nombres traen tildes en latin-1 ("BEBIDAS ALCOHÓLICAS").
  const decoder = new TextDecoder("latin1");
  const byMonth = new Map<string, Map<string, number>>();
  const yearTotals = new Map<string, number>();

  let header: string[] = [];
  let iMonth = -1;
  let iGroup = -1;
  let iValue = -1;
  let pending = "";

  const consume = (line: string) => {
    if (!line) return;

    if (!header.length) {
      header = line.trim().split("|");
      iMonth = header.indexOf("MES");
      iGroup = header.indexOf("GRUPO_IMPUESTO");
      iValue = header.indexOf("VALOR_RECAUDADO");
      if (iMonth < 0 || iGroup < 0 || iValue < 0) {
        throw new Error("El CSV del SRI cambió de estructura");
      }
      return;
    }

    const cells = line.split("|");
    if (cells.length < header.length) return;

    const month = (cells[iMonth] || "").trim();
    const group = (cells[iGroup] || "").trim();
    const value = parseSriNumber(cells[iValue] || "") / 1e6; // millones de USD
    if (!month) return;

    let bucket = byMonth.get(month);
    if (!bucket) byMonth.set(month, (bucket = new Map()));

    bucket.set(group, (bucket.get(group) || 0) + value);
    bucket.set("TOTAL", (bucket.get("TOTAL") || 0) + value);
    yearTotals.set(group, (yearTotals.get(group) || 0) + value);
    yearTotals.set("TOTAL", (yearTotals.get("TOTAL") || 0) + value);
  };

  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    pending += decoder.decode(chunk, { stream: true });

    let cut = pending.indexOf("\n");
    while (cut >= 0) {
      consume(pending.slice(0, cut).replace(/\r$/, ""));
      pending = pending.slice(cut + 1);
      cut = pending.indexOf("\n");
    }
  }
  consume(pending.replace(/\r$/, ""));

  if (!byMonth.size) throw new Error(`El SRI aún no publica datos de ${year}`);

  // Las etiquetas vienen como "06 Junio": el prefijo numérico ya ordena.
  const latestMonth = [...byMonth.keys()].sort().pop() as string;

  const totals: SriTotals = {
    year,
    latestMonth,
    monthNumber: Number(latestMonth.slice(0, 2)) || 12,
    month: byMonth.get(latestMonth) as Map<string, number>,
    year_: yearTotals,
  };

  sriCache.set(year, { totals, at: Date.now() });
  return totals;
}

/** El símbolo llega como "mes|TOTAL" o "acumulado|IMPUESTO AL VALOR AGREGADO". */
async function fromSri(symbol: string): Promise<FetchedValue> {
  const [rawScope, ...rest] = symbol.split("|");
  const scope = (rawScope || "mes").trim().toLowerCase();
  const group = (rest.join("|").trim() || "TOTAL").toUpperCase();

  const currentYear = new Date().getFullYear();

  // En enero el archivo del año nuevo puede no existir todavía.
  let totals: SriTotals;
  try {
    totals = await loadSriTotals(currentYear);
  } catch (error) {
    totals = await loadSriTotals(currentYear - 1);
    void error;
  }

  const table = scope === "acumulado" || scope === "anio" ? totals.year_ : totals.month;
  const value = table.get(group);

  if (typeof value !== "number") {
    const available = [...table.keys()].filter((key) => key !== "TOTAL").slice(0, 6).join(", ");
    throw new Error(`El SRI no reporta «${group}». Disponibles: ${available}`);
  }

  // El dato corresponde al mes cerrado: lo fechamos a fin de mes.
  const measuredAt = new Date(Date.UTC(totals.year, totals.monthNumber, 0, 12));
  const period = scope === "acumulado" || scope === "anio"
    ? `acumulado ${totals.year} a ${totals.latestMonth}`
    : `${totals.latestMonth} ${totals.year}`;

  return { value, measuredAt, label: `${group} · ${period}` };
}

/* ------------------------------------------------------------------ */
/* Yahoo Finance — materias primas, divisas, índices y ETF             */
/* ------------------------------------------------------------------ */

interface YahooChart {
  chart?: {
    result?: { meta?: { regularMarketPrice?: number; regularMarketTime?: number; symbol?: string } }[];
    error?: { description?: string };
  };
}

async function fromYahoo(symbol: string): Promise<FetchedValue> {
  const body = await getJson<YahooChart>(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`,
  );

  if (body.chart?.error) throw new Error(body.chart.error.description || "Símbolo no encontrado");

  const meta = body.chart?.result?.[0]?.meta;
  const value = meta?.regularMarketPrice;
  if (typeof value !== "number") throw new Error(`Yahoo no devolvió precio para ${symbol}`);

  return {
    value,
    measuredAt: meta?.regularMarketTime ? new Date(meta.regularMarketTime * 1000) : new Date(),
    label: meta?.symbol || symbol,
  };
}

/* ------------------------------------------------------------------ */
/* Banco Mundial — macro de Ecuador (anual, con rezago)                */
/* ------------------------------------------------------------------ */

type WorldBankResponse = [unknown, { date?: string; value?: number | null }[] | null];

async function fromWorldBank(indicator: string, country = "EC"): Promise<FetchedValue> {
  const body = await getJson<WorldBankResponse>(
    `https://api.worldbank.org/v2/country/${country}/indicator/${encodeURIComponent(indicator)}?format=json&mrv=1`,
  );

  const entry = body?.[1]?.[0];
  if (!entry || typeof entry.value !== "number") {
    throw new Error(`El Banco Mundial no tiene dato reciente para ${indicator}`);
  }

  return {
    value: entry.value,
    measuredAt: entry.date ? new Date(`${entry.date}-12-31T12:00:00Z`) : new Date(),
    label: `${indicator} ${entry.date || ""}`.trim(),
  };
}

/* ------------------------------------------------------------------ */
/* Frankfurter — tipos de cambio del BCE                               */
/* ------------------------------------------------------------------ */

interface FrankfurterResponse {
  date?: string;
  rates?: Record<string, number>;
}

async function fromFrankfurter(symbol: string): Promise<FetchedValue> {
  // El símbolo llega como "USD/EUR" o simplemente "EUR" (desde USD).
  const [from, to] = symbol.includes("/") ? symbol.split("/") : ["USD", symbol];

  const body = await getJson<FrankfurterResponse>(
    `https://api.frankfurter.app/latest?from=${encodeURIComponent(from || "USD")}&to=${encodeURIComponent(to || "EUR")}`,
  );

  const value = body.rates?.[(to || "EUR").toUpperCase()];
  if (typeof value !== "number") throw new Error(`Sin cotización para ${symbol}`);

  return {
    value,
    measuredAt: body.date ? new Date(`${body.date}T12:00:00Z`) : new Date(),
    label: `${from}/${to}`,
  };
}

/* ------------------------------------------------------------------ */
/* JSON genérico — cualquier endpoint propio                           */
/* ------------------------------------------------------------------ */

/** Lee una ruta tipo `data.0.value` dentro de la respuesta. */
function readPath(payload: unknown, path: string): unknown {
  return path
    .split(".")
    .filter(Boolean)
    .reduce<unknown>((current, key) => {
      if (current === null || current === undefined) return undefined;
      if (Array.isArray(current)) return current[Number(key)];
      if (typeof current === "object") return (current as Record<string, unknown>)[key];
      return undefined;
    }, payload);
}

async function fromGenericJson(url: string, path: string): Promise<FetchedValue> {
  if (!url) throw new Error("Falta la URL de la fuente");

  const body = await getJson<unknown>(url);
  const raw = path ? readPath(body, path) : body;
  const value = typeof raw === "string" ? Number(raw.replace(/[^\d.,-]/g, "").replace(",", ".")) : Number(raw);

  if (!Number.isFinite(value)) throw new Error(`La ruta «${path}» no devolvió un número`);

  return { value, measuredAt: new Date(), label: path || url };
}

/* ------------------------------------------------------------------ */

export async function fetchIndicatorValue(source: IndicatorSource): Promise<FetchedValue> {
  const symbol = (source.symbol || "").trim();

  let result: FetchedValue;

  switch (source.provider) {
    case "bce":
      if (!symbol) throw new Error("Falta el indicador del BCE");
      result = await fromBce(symbol);
      break;
    case "sri":
      result = await fromSri(symbol || "mes|TOTAL");
      break;
    case "yahoo":
      if (!symbol) throw new Error("Falta el símbolo de Yahoo Finance");
      result = await fromYahoo(symbol);
      break;
    case "worldbank":
      if (!symbol) throw new Error("Falta el código del indicador del Banco Mundial");
      result = await fromWorldBank(symbol);
      break;
    case "frankfurter":
      result = await fromFrankfurter(symbol || "EUR");
      break;
    case "json":
      result = await fromGenericJson(source.url || "", source.path || "");
      break;
    default:
      throw new Error("Este indicador se actualiza a mano");
  }

  const multiplier = Number(source.multiplier);
  if (Number.isFinite(multiplier) && multiplier !== 0 && multiplier !== 1) {
    result.value *= multiplier;
  }

  return { ...result, value: Number(result.value.toFixed(4)) };
}

/** Catálogo para el desplegable del panel: fuentes probadas y listas para usar. */
export const SOURCE_PRESETS = [
  // --- Banco Central del Ecuador (oficial) ---
  { provider: "bce", symbol: "formulario|Riesgo País", label: "Riesgo país EMBI (puntos)", format: "number" },
  { provider: "bce", symbol: "formulario|Precio del Oro", label: "Precio del oro (USD/onza)", format: "currency" },
  { provider: "bce", symbol: "diarios|Precio Petróleo (WTI)", label: "Petróleo WTI · BCE (USD/barril)", format: "currency" },
  { provider: "bce", symbol: "diarios|Índice Dow Jones", label: "Índice Dow Jones (puntos)", format: "number" },
  { provider: "bce", symbol: "diarios|Tasa SOFR", label: "Tasa SOFR (%)", format: "percent" },
  { provider: "bce", symbol: "diarios|Tasa Líbor", label: "Tasa Líbor (%)", format: "percent" },
  { provider: "bce", symbol: "monetario|Tasa Activa Referencial", label: "Tasa activa referencial (%)", format: "percent" },
  { provider: "bce", symbol: "monetario|Tasa Pasiva Referencial", label: "Tasa pasiva referencial (%)", format: "percent" },
  { provider: "bce", symbol: "monetario|Reservas Internacionales", label: "Reservas internacionales (M USD)", format: "number" },
  { provider: "bce", symbol: "monetario|Liquidez Total M2", label: "Liquidez total M2 (M USD)", format: "number" },
  {
    provider: "bce",
    symbol: "monetario|Crédito al Sector Privado (empresas y hogares) de OSD",
    label: "Crédito al sector privado (M USD)",
    format: "number",
  },
  { provider: "bce", symbol: "monetario|Captaciones OSD (Total)", label: "Captaciones OSD (M USD)", format: "number" },
  { provider: "bce", symbol: "externo|Saldo Balanza Comercial", label: "Saldo balanza comercial (M USD)", format: "number" },
  { provider: "bce", symbol: "externo|Exportaciones de Bienes", label: "Exportaciones de bienes (M USD)", format: "number" },
  { provider: "bce", symbol: "externo|Importaciones de Bienes", label: "Importaciones de bienes (M USD)", format: "number" },
  {
    provider: "bce",
    symbol: "externo|Balanza Comercial no Petrolera",
    label: "Balanza comercial no petrolera (M USD)",
    format: "number",
  },
  { provider: "bce", symbol: "balanza|Remesas de Trabajadores Recibidas", label: "Remesas recibidas (M USD)", format: "number" },
  { provider: "bce", symbol: "balanza|Cuenta Corriente", label: "Cuenta corriente (M USD)", format: "number" },
  { provider: "bce", symbol: "balanza|Efectivo Real", label: "Índice de tipo de cambio real", format: "number" },

  // --- SRI (oficial, mensual) — valores en millones de USD ---
  { provider: "sri", symbol: "mes|TOTAL", label: "Recaudación del último mes (M USD)", format: "number" },
  { provider: "sri", symbol: "acumulado|TOTAL", label: "Recaudación acumulada del año (M USD)", format: "number" },
  {
    provider: "sri",
    symbol: "mes|IMPUESTO AL VALOR AGREGADO",
    label: "IVA del último mes (M USD)",
    format: "number",
  },
  {
    provider: "sri",
    symbol: "mes|IMPUESTO A LA RENTA GLOBAL",
    label: "Impuesto a la renta del último mes (M USD)",
    format: "number",
  },
  {
    provider: "sri",
    symbol: "acumulado|IMPUESTO AL VALOR AGREGADO",
    label: "IVA acumulado del año (M USD)",
    format: "number",
  },
  {
    provider: "sri",
    symbol: "acumulado|IMPUESTO A LA RENTA GLOBAL",
    label: "Renta acumulada del año (M USD)",
    format: "number",
  },
  { provider: "sri", symbol: "acumulado|SALIDA DE DIVISAS", label: "ISD acumulado del año (M USD)", format: "number" },
  { provider: "sri", symbol: "acumulado|IMP MINERAS", label: "Impuestos mineros acumulados (M USD)", format: "number" },

  // --- Fuentes internacionales ---
  { provider: "yahoo", symbol: "CL=F", label: "Petróleo WTI (barril USD)", format: "currency" },
  { provider: "yahoo", symbol: "BZ=F", label: "Petróleo Brent (barril USD)", format: "currency" },
  { provider: "yahoo", symbol: "GC=F", label: "Oro (onza USD)", format: "currency" },
  { provider: "yahoo", symbol: "EMB", label: "Deuda emergente EMB (USD)", format: "currency" },
  { provider: "yahoo", symbol: "^TNX", label: "Bono EE. UU. 10 años (%)", format: "percent" },
  { provider: "yahoo", symbol: "BTC-USD", label: "Bitcoin (USD)", format: "currency" },
  { provider: "frankfurter", symbol: "USD/EUR", label: "Dólar / Euro", format: "number" },
  { provider: "frankfurter", symbol: "USD/COP", label: "Dólar / Peso colombiano", format: "number" },
  { provider: "worldbank", symbol: "FP.CPI.TOTL.ZG", label: "Inflación anual Ecuador (%)", format: "percent" },
  { provider: "worldbank", symbol: "NY.GDP.MKTP.KD.ZG", label: "Crecimiento del PIB Ecuador (%)", format: "percent" },
  { provider: "worldbank", symbol: "SL.UEM.TOTL.ZS", label: "Desempleo Ecuador (%)", format: "percent" },
] as const;

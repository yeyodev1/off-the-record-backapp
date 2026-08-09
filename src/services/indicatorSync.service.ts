import { IndicatorModel } from "../models/indicator.model";
import { fetchIndicatorValue, type IndicatorSource } from "./indicatorSource.service";

const DEFAULT_REFRESH_HOURS = 6;

export interface SyncResult {
  id: string;
  name: string;
  status: "ok" | "error" | "skipped";
  value?: number;
  previousValue?: number | null;
  message?: string;
}

/**
 * Trae el valor nuevo y lo guarda conservando el histórico. Si el valor no
 * cambió no se toca `previousValue`: así la variación mostrada sigue siendo
 * la del último movimiento real.
 */
export async function syncIndicator(id: string, force = false): Promise<SyncResult> {
  const indicator = await IndicatorModel.findById(id);
  if (!indicator) return { id, name: "", status: "error", message: "Indicador no encontrado" };

  const doc = indicator.toObject();
  const source = (doc.feed || { provider: "manual" }) as IndicatorSource;

  if (source.provider === "manual") {
    // "Manual" no es un fallo: si arrastraba un error de una conexión previa,
    // lo limpiamos para que el panel no lo pinte como fuente caída.
    if (indicator.lastSyncStatus === "error") {
      indicator.lastSyncStatus = "pending";
      indicator.lastSyncError = "";
      await indicator.save();
    }

    return { id, name: doc.name, status: "skipped", message: "Se actualiza a mano" };
  }

  if (!force) {
    const hours = Number(source.refreshHours) || DEFAULT_REFRESH_HOURS;
    const last = doc.lastSyncAt ? new Date(doc.lastSyncAt).getTime() : 0;
    if (last && Date.now() - last < hours * 3600_000) {
      return { id, name: doc.name, status: "skipped", message: "Aún dentro de la cadencia" };
    }
  }

  try {
    const fetched = await fetchIndicatorValue(source);

    if (fetched.value !== indicator.value) {
      indicator.previousValue = indicator.value;
      indicator.value = fetched.value;
      indicator.history.push({ value: fetched.value, at: fetched.measuredAt });
      if (indicator.history.length > 120) {
        indicator.history.splice(0, indicator.history.length - 120);
      }
      indicator.measuredAt = fetched.measuredAt;
    }

    indicator.lastSyncAt = new Date();
    indicator.lastSyncStatus = "ok";
    indicator.lastSyncError = "";
    await indicator.save();

    return {
      id,
      name: indicator.name,
      status: "ok",
      value: indicator.value,
      previousValue: indicator.previousValue,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falló la consulta a la fuente";

    // Un fallo de la fuente nunca borra el último valor bueno.
    indicator.lastSyncAt = new Date();
    indicator.lastSyncStatus = "error";
    indicator.lastSyncError = message;
    await indicator.save();

    return { id, name: indicator.name, status: "error", message };
  }
}

/** Sincroniza todos los conectados. La llama el scheduler cada minuto. */
export async function syncDueIndicators(force = false): Promise<SyncResult[]> {
  const connected = await IndicatorModel.find({
    active: true,
    "feed.provider": { $ne: "manual" },
  }).select("_id");

  const results: SyncResult[] = [];

  // En serie: son pocos y así no saturamos las fuentes gratuitas.
  for (const indicator of connected) {
    results.push(await syncIndicator(String(indicator._id), force));
  }

  const updated = results.filter((result) => result.status === "ok");
  if (updated.length) {
    console.log(`Indicadores sincronizados: ${updated.map((result) => result.name).join(", ")}`);
  }

  return results;
}

import { Schema, model, InferSchemaType } from "mongoose";

/**
 * Economic indicators shown in the daily brief chart.
 */
const indicatorSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, trim: true, default: "", index: true },
    value: { type: Number, required: true },
    previousValue: { type: Number, default: null },
    unit: { type: String, default: "" },
    format: { type: String, enum: ["number", "currency", "percent"], default: "number" },
    source: { type: String, default: "" },
    color: { type: String, default: "#C9A84C" },
    order: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
    history: {
      type: [
        new Schema(
          {
            value: { type: Number, required: true },
            at: { type: Date, default: Date.now },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    measuredAt: { type: Date, default: Date.now, index: true },

    // Conexión con la fuente automática ("source" sigue siendo la atribución
    // legible: JP Morgan, BCE…). "manual" conserva el comportamiento de
    // siempre: el valor lo escribe una persona.
    feed: {
      provider: {
        type: String,
        enum: ["manual", "bce", "sri", "yahoo", "worldbank", "frankfurter", "json"],
        default: "manual",
      },
      symbol: { type: String, default: "" },
      url: { type: String, default: "" },
      path: { type: String, default: "" },
      multiplier: { type: Number, default: 1 },
      refreshHours: { type: Number, default: 6 },
    },
    lastSyncAt: { type: Date, default: null },
    lastSyncStatus: { type: String, enum: ["ok", "error", "pending"], default: "pending" },
    lastSyncError: { type: String, default: "" },
  },
  { timestamps: true, versionKey: false },
);

export type IndicatorDocument = InferSchemaType<typeof indicatorSchema>;

export const IndicatorModel = model("Indicator", indicatorSchema);

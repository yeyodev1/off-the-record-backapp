import { Schema, model, InferSchemaType } from "mongoose";

const metricSchema = new Schema(
  {
    label: { type: String, required: true },
    value: { type: Number, default: 0 },
    unit: { type: String, default: "" },
    delta: { type: Number, default: null },
    color: { type: String, default: "#C8392B" },
  },
  { _id: false },
);

const entrySchema = new Schema(
  {
    id: { type: String, default: "" },
    kind: { type: String, default: "article" },
    title: { type: String, default: "" },
    category: { type: String, default: "" },
    reads: { type: Number, default: 0 },
    uniqueReaders: { type: Number, default: 0 },
    color: { type: String, default: "" },
  },
  { _id: false },
);

/**
 * Reporte editorial diario o mensual. Se genera solo desde el scheduler y
 * también a demanda desde el panel.
 */
const reportSchema = new Schema(
  {
    kind: { type: String, enum: ["daily", "monthly"], required: true, index: true },
    periodKey: { type: String, required: true, index: true },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    title: { type: String, default: "" },
    headline: { type: String, default: "" },
    narrative: { type: String, default: "" },
    highlights: { type: [String], default: [] },
    recommendations: { type: [String], default: [] },
    metrics: { type: [metricSchema], default: [] },
    sections: { type: [entrySchema], default: [] },
    topContent: { type: [entrySchema], default: [] },
    published: { type: [entrySchema], default: [] },
    indicators: { type: Schema.Types.Mixed, default: [] },
    chart: { type: Schema.Types.Mixed, default: null },
    engine: { type: String, default: "" },
    generatedBy: { type: String, enum: ["auto", "manual"], default: "auto" },
    generatedAt: { type: Date, default: Date.now },
    error: { type: String, default: "" },
  },
  { timestamps: true, versionKey: false },
);

reportSchema.index({ kind: 1, periodKey: 1 }, { unique: true });

export type ReportDocument = InferSchemaType<typeof reportSchema>;

export const ReportModel = model("Report", reportSchema);

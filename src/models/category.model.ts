import { Schema, model, InferSchemaType } from "mongoose";

/**
 * Categories drive two things at once:
 *  - `content`: editorial sections used for reading statistics.
 *  - `audience`: user segments used for access control and notifications.
 */
const categorySchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, trim: true, default: "", index: true },
    scope: { type: String, enum: ["content", "audience"], default: "content", index: true },
    color: { type: String, default: "#C8392B" },
    icon: { type: String, default: "fa-solid fa-layer-group" },
    description: { type: String, default: "" },
    order: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, versionKey: false },
);

categorySchema.index({ scope: 1, name: 1 }, { unique: true });

export type CategoryDocument = InferSchemaType<typeof categorySchema>;

export const CategoryModel = model("Category", categorySchema);

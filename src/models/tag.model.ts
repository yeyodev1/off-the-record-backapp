import { Schema, model, InferSchemaType } from "mongoose";

/**
 * Etiqueta editorial.
 *
 * El `slug` es la defensa contra los duplicados: normaliza mayúsculas, tildes y
 * espacios, así que «Corrupción», «corrupcion» y «CORRUPCIÓN» colapsan en la
 * misma entrada. El índice único lo garantiza a nivel de base de datos.
 */
const tagSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, index: true },
    color: { type: String, default: "#7B6CF6" },
    description: { type: String, default: "" },
    usageCount: { type: Number, default: 0, index: true },
    active: { type: Boolean, default: true },
    createdBy: { type: String, default: "" },
    createdByName: { type: String, default: "" },
  },
  { timestamps: true, versionKey: false },
);

export type TagDocument = InferSchemaType<typeof tagSchema>;

export const TagModel = model("Tag", tagSchema);

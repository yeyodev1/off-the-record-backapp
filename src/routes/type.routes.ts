import { buildResourceRouter } from "../utils/resourceRouter";
import { TypeModel } from "../models/type.model";

export default buildResourceRouter(TypeModel, {
  searchableFields: ["name"],
});

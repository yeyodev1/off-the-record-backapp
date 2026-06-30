import { buildResourceRouter } from "../utils/resourceRouter";
import { ExclusiveModel } from "../models/exclusive.model";

export default buildResourceRouter(ExclusiveModel, {
  searchableFields: ["title", "summary", "description"],
});

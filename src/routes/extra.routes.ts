import { buildResourceRouter } from "../utils/resourceRouter";
import { ExtraModel } from "../models/extra.model";

export default buildResourceRouter(ExtraModel, {
  searchableFields: ["userId", "articleId"],
});

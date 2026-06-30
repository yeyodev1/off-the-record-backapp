import { buildResourceRouter } from "../utils/resourceRouter";
import { LogModel } from "../models/log.model";

export default buildResourceRouter(LogModel, {
  searchableFields: ["userId", "articleId"],
});

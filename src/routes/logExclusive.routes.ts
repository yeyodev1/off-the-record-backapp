import { buildResourceRouter } from "../utils/resourceRouter";
import { LogExclusiveModel } from "../models/logExclusive.model";

export default buildResourceRouter(LogExclusiveModel, {
  searchableFields: ["userId", "exclusiveId"],
});

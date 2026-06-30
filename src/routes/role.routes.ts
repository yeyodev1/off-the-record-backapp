import { buildResourceRouter } from "../utils/resourceRouter";
import { RoleModel } from "../models/role.model";

export default buildResourceRouter(RoleModel, {
  searchableFields: ["name"],
});

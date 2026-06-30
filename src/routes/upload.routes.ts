import { buildResourceRouter } from "../utils/resourceRouter";
import { UploadModel } from "../models/upload.model";

export default buildResourceRouter(UploadModel, {
  searchableFields: ["name", "url"],
});

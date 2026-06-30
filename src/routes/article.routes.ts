import { buildResourceRouter } from "../utils/resourceRouter";
import { ArticleModel } from "../models/article.model";

export default buildResourceRouter(ArticleModel, {
  searchableFields: ["title", "key", "summary", "description", "observations"],
});

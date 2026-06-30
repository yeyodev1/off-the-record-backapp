import { buildResourceRouter } from "../utils/resourceRouter";
import { NotificationModel } from "../models/notification.model";

export default buildResourceRouter(NotificationModel, {
  searchableFields: ["message"],
});

import express, { Application } from "express";
import authRoutes from "./auth.routes";
import roleRoutes from "./role.routes";
import typeRoutes from "./type.routes";
import userRoutes from "./user.routes";
import articleRoutes from "./article.routes";
import exclusiveRoutes from "./exclusive.routes";
import notificationRoutes from "./notification.routes";
import uploadRoutes from "./upload.routes";
import extraRoutes from "./extra.routes";
import logRoutes from "./log.routes";
import logExclusiveRoutes from "./logExclusive.routes";

function routerApi(app: Application) {
  const router = express.Router();
  app.use("/api", router);

  router.use(authRoutes);
  router.use("/roles", roleRoutes);
  router.use("/types", typeRoutes);
  router.use("/users", userRoutes);
  router.use("/articles", articleRoutes);
  router.use("/exclusives", exclusiveRoutes);
  router.use("/notifications", notificationRoutes);
  router.use("/uploads", uploadRoutes);
  router.use("/extras", extraRoutes);
  router.use("/logs", logRoutes);
  router.use("/logexclusives", logExclusiveRoutes);
}

export default routerApi;

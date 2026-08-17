import express, { Application } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { ADMIN_ROLE_ID, EDITOR_ROLE_ID, requireRoles, requireSuperadmin } from "../middlewares/role.middleware";
import { asyncHandler } from "../utils/asyncHandler";

import { ArticleModel } from "../models/article.model";
import { UpdateModel } from "../models/update.model";
import { RoleModel } from "../models/role.model";
import { TypeModel } from "../models/type.model";

import { buildContentController, buildShareReader } from "../controllers/content.controller";
import * as auth from "../controllers/auth.controller";
import * as users from "../controllers/user.controller";
import * as catalog from "../controllers/catalog.controller";
import * as notifications from "../controllers/notification.controller";
import * as analytics from "../controllers/analytics.controller";
import * as reader from "../controllers/reader.controller";
import * as settings from "../controllers/settings.controller";
import * as ai from "../controllers/ai.controller";
import * as receipts from "../controllers/receipts.controller";
import * as reports from "../controllers/report.controller";
import * as tags from "../controllers/tag.controller";
import { listUploads, uploadToCloudinary } from "../controllers/upload.controller";
import { healthCheck } from "../controllers/health.controller";

const EDITORIAL = requireRoles(ADMIN_ROLE_ID, EDITOR_ROLE_ID);
const ADMIN_ONLY = requireRoles(ADMIN_ROLE_ID);

function contentRoutes(model: typeof ArticleModel, kind: "article" | "update") {
  const controller = buildContentController(model as never, kind);
  const router = express.Router();

  router.use(authMiddleware);
  router.get("/", EDITORIAL, asyncHandler(controller.list));
  router.get("/feed", asyncHandler(controller.listPublic));
  router.get("/:id", asyncHandler(controller.detail));
  router.post("/", EDITORIAL, asyncHandler(controller.create));
  router.put("/:id", EDITORIAL, asyncHandler(controller.update));
  router.delete("/:id", EDITORIAL, asyncHandler(controller.remove));
  router.post("/:id/share", EDITORIAL, asyncHandler(controller.share));
  router.post("/:id/read", asyncHandler(controller.registerRead));

  return router;
}

function catalogRoutes(model: typeof RoleModel) {
  const router = express.Router();
  router.use(authMiddleware);

  router.get(
    "/",
    asyncHandler(async (_req, res) => {
      const data = await model.find({}).sort({ name: 1 });
      res.json({ data });
    }),
  );

  return router;
}

function routerApi(app: Application) {
  const router = express.Router();
  app.use("/api", router);

  /* Salud y sesión ------------------------------------------------- */
  router.get("/health", asyncHandler(healthCheck));
  router.post("/sign-in", asyncHandler(auth.signIn));
  router.post("/refresh-access-token", asyncHandler(auth.refreshAccessToken));
  router.post("/recover-password", asyncHandler(auth.recoverPassword));
  router.post("/sign-out", authMiddleware, asyncHandler(auth.signOut));
  router.post("/change-password", authMiddleware, asyncHandler(auth.changeOwnPassword));
  router.get("/me", authMiddleware, asyncHandler(users.me));
  router.put("/me", authMiddleware, asyncHandler(users.updateMe));

  /* Enlaces públicos compartidos por Signal ------------------------ */
  router.get("/shared/r/:token", asyncHandler(buildShareReader(ArticleModel as never, "article")));
  router.get("/shared/a/:token", asyncHandler(buildShareReader(UpdateModel as never, "update")));

  /* Contenido ------------------------------------------------------ */
  router.use("/articles", contentRoutes(ArticleModel, "article"));
  router.use("/updates", contentRoutes(UpdateModel as never, "update"));

  router.get("/reader/facets", authMiddleware, asyncHandler(reader.readerFacets));

  /* Integraciones de mensajería ------------------------------------ */
  router.get("/settings", authMiddleware, EDITORIAL, asyncHandler(settings.readSettings));
  router.put("/settings", authMiddleware, ADMIN_ONLY, asyncHandler(settings.saveSettings));
  router.get("/settings/channels", authMiddleware, EDITORIAL, asyncHandler(settings.channelStatus));
  router.post("/settings/channels/:channel/test", authMiddleware, ADMIN_ONLY, asyncHandler(settings.testChannel));

  /* Catálogos ------------------------------------------------------ */
  router.use("/roles", catalogRoutes(RoleModel));
  router.use("/types", catalogRoutes(TypeModel));

  router.get("/categories", authMiddleware, asyncHandler(catalog.listCategories));
  router.post("/categories", authMiddleware, ADMIN_ONLY, asyncHandler(catalog.createCategory));
  router.put("/categories/:id", authMiddleware, ADMIN_ONLY, asyncHandler(catalog.updateCategory));
  router.delete("/categories/:id", authMiddleware, ADMIN_ONLY, asyncHandler(catalog.deleteCategory));

  router.get("/tags", authMiddleware, asyncHandler(tags.listTags));
  router.post("/tags", authMiddleware, EDITORIAL, asyncHandler(tags.createTag));
  router.put("/tags/:id", authMiddleware, EDITORIAL, asyncHandler(tags.updateTag));
  router.post("/tags/:id/merge", authMiddleware, EDITORIAL, asyncHandler(tags.mergeTagHandler));
  router.post("/tags/recount", authMiddleware, EDITORIAL, asyncHandler(tags.recountTagsHandler));
  router.delete("/tags/:id", authMiddleware, ADMIN_ONLY, asyncHandler(tags.deleteTag));

  router.get("/indicators", authMiddleware, asyncHandler(catalog.listIndicators));
  router.get("/indicators/presets", authMiddleware, EDITORIAL, asyncHandler(catalog.indicatorPresets));
  router.post("/indicators/sync", authMiddleware, EDITORIAL, asyncHandler(catalog.syncIndicators));
  router.post("/indicators/:id/sync", authMiddleware, EDITORIAL, asyncHandler(catalog.syncIndicators));
  router.post("/indicators", authMiddleware, EDITORIAL, asyncHandler(catalog.createIndicator));
  router.put("/indicators/:id", authMiddleware, EDITORIAL, asyncHandler(catalog.updateIndicator));
  router.delete("/indicators/:id", authMiddleware, ADMIN_ONLY, asyncHandler(catalog.deleteIndicator));

  /* Usuarios y archivos -------------------------------------------- */
  router.get("/users", authMiddleware, ADMIN_ONLY, asyncHandler(users.listUsers));
  router.post("/users", authMiddleware, ADMIN_ONLY, asyncHandler(users.createUser));
  router.get("/users/:id", authMiddleware, ADMIN_ONLY, asyncHandler(users.getUser));
  router.put("/users/:id", authMiddleware, ADMIN_ONLY, asyncHandler(users.updateUser));
  router.delete("/users/:id", authMiddleware, ADMIN_ONLY, asyncHandler(users.deleteUser));
  router.get("/users/:id/archives", authMiddleware, ADMIN_ONLY, asyncHandler(users.listArchives));
  router.post("/users/:id/archives", authMiddleware, ADMIN_ONLY, asyncHandler(users.addArchive));
  router.delete("/users/:id/archives/:archiveId", authMiddleware, ADMIN_ONLY, asyncHandler(users.removeArchive));

  /* Notificaciones -------------------------------------------------- */
  router.get("/notifications/mine", authMiddleware, asyncHandler(notifications.myNotifications));
  router.post("/notifications/:id/read", authMiddleware, asyncHandler(notifications.markNotificationRead));
  router.get("/notifications", authMiddleware, EDITORIAL, asyncHandler(notifications.listNotifications));
  router.post("/notifications", authMiddleware, EDITORIAL, asyncHandler(notifications.createNotification));
  router.put("/notifications/:id", authMiddleware, EDITORIAL, asyncHandler(notifications.updateNotification));
  router.post("/notifications/:id/send", authMiddleware, EDITORIAL, asyncHandler(notifications.sendNotification));
  router.delete("/notifications/:id", authMiddleware, ADMIN_ONLY, asyncHandler(notifications.deleteNotification));

  /* Acuses de lectura (solo superadmin) ----------------------------- */
  router.get("/receipts/articles/:id", authMiddleware, requireSuperadmin, asyncHandler(receipts.articleReceipts));
  router.get("/receipts/updates/:id", authMiddleware, requireSuperadmin, asyncHandler(receipts.updateReceipts));
  router.get(
    "/receipts/notifications/:id",
    authMiddleware,
    requireSuperadmin,
    asyncHandler(receipts.notificationReceiptsHandler),
  );
  router.get("/receipts/inactive", authMiddleware, requireSuperadmin, asyncHandler(receipts.inactive));

  /* Analítica ------------------------------------------------------- */
  router.get("/analytics/overview", authMiddleware, EDITORIAL, asyncHandler(analytics.overview));
  router.get("/analytics/sections", authMiddleware, EDITORIAL, asyncHandler(analytics.sections));
  router.get("/analytics/top", authMiddleware, EDITORIAL, asyncHandler(analytics.top));
  router.get("/analytics/readers", authMiddleware, ADMIN_ONLY, asyncHandler(analytics.readers));
  router.get("/analytics/access-log", authMiddleware, ADMIN_ONLY, asyncHandler(analytics.accessLog));
  router.get("/analytics/read-log", authMiddleware, ADMIN_ONLY, asyncHandler(analytics.readLog));
  router.get("/analytics/brief", authMiddleware, asyncHandler(analytics.brief));

  /* Inteligencia artificial ----------------------------------------- */
  router.get("/ai/capabilities", authMiddleware, asyncHandler(ai.capabilities));
  router.post("/ai/summary", authMiddleware, EDITORIAL, asyncHandler(ai.summary));
  router.post("/ai/intertitles", authMiddleware, EDITORIAL, asyncHandler(ai.intertitles));
  router.post("/ai/headlines", authMiddleware, EDITORIAL, asyncHandler(ai.headlines));
  router.post("/ai/infographic", authMiddleware, EDITORIAL, asyncHandler(ai.infographic));
  router.post("/ai/infographic-posters", authMiddleware, EDITORIAL, asyncHandler(ai.infographicPosters));
  router.post("/ai/infographic-posters/choose", authMiddleware, EDITORIAL, asyncHandler(ai.infographicChoose));
  router.post("/ai/photos", authMiddleware, EDITORIAL, asyncHandler(ai.photos));
  router.post("/ai/photos/choose", authMiddleware, EDITORIAL, asyncHandler(ai.photoChoose));
  router.post("/ai/image", authMiddleware, EDITORIAL, asyncHandler(ai.image));
  router.post("/ai/audio", authMiddleware, EDITORIAL, asyncHandler(ai.audio));
  router.post("/ai/video", authMiddleware, EDITORIAL, asyncHandler(ai.video));
  router.post("/ai/video/status", authMiddleware, EDITORIAL, asyncHandler(ai.videoStatus));
  router.post("/ai/spellcheck", authMiddleware, asyncHandler(ai.spellcheck));

  /* Reportes diario y mensual ---------------------------------------- */
  router.get("/reports", authMiddleware, EDITORIAL, asyncHandler(reports.listReports));
  router.get("/reports/latest", authMiddleware, EDITORIAL, asyncHandler(reports.latestReport));
  router.get("/reports/:id", authMiddleware, EDITORIAL, asyncHandler(reports.getReport));
  router.post("/reports", authMiddleware, EDITORIAL, asyncHandler(reports.createReport));
  router.delete("/reports/:id", authMiddleware, ADMIN_ONLY, asyncHandler(reports.deleteReport));

  /* Archivos --------------------------------------------------------- */
  router.get("/uploads", authMiddleware, EDITORIAL, asyncHandler(listUploads));
  router.post("/uploads/cloudinary", authMiddleware, EDITORIAL, asyncHandler(uploadToCloudinary));
}

export default routerApi;

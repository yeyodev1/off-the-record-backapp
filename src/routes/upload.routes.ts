import { Router } from "express";
import { UploadModel } from "../models/upload.model";
import { authMiddleware } from "../middlewares/auth.middleware";
import { ADMIN_ROLE_ID, EDITOR_ROLE_ID, requireRoles } from "../middlewares/role.middleware";
import { asyncHandler } from "../utils/asyncHandler";
import { uploadToCloudinary } from "../controllers/upload.controller";
import { buildResourceRouter } from "../utils/resourceRouter";

const resourceRouter = buildResourceRouter(UploadModel, {
  searchableFields: ["name", "url"],
});

const router = Router();
router.use(authMiddleware);
router.post("/cloudinary", requireRoles(ADMIN_ROLE_ID, EDITOR_ROLE_ID), asyncHandler(uploadToCloudinary));
router.use("/", resourceRouter);

export default router;

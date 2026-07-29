import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { requireRoles, ADMIN_ROLE_ID, EDITOR_ROLE_ID } from "../middlewares/role.middleware";
import { asyncHandler } from "../utils/asyncHandler";
import { createArticle, deleteArticle, getArticle, listArticles, listPublicArticles, updateArticle } from "../controllers/article.controller";

const router = Router();

router.get("/public", asyncHandler(listPublicArticles));
router.use(authMiddleware);
router.get("/", requireRoles(ADMIN_ROLE_ID, EDITOR_ROLE_ID), asyncHandler(listArticles));
router.get("/:id", requireRoles(ADMIN_ROLE_ID, EDITOR_ROLE_ID), asyncHandler(getArticle));
router.post("/", requireRoles(ADMIN_ROLE_ID, EDITOR_ROLE_ID), asyncHandler(createArticle));
router.put("/:id", requireRoles(ADMIN_ROLE_ID, EDITOR_ROLE_ID), asyncHandler(updateArticle));
router.delete("/:id", requireRoles(ADMIN_ROLE_ID, EDITOR_ROLE_ID), asyncHandler(deleteArticle));

export default router;

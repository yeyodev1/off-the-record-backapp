import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { ADMIN_ROLE_ID, requireRoles } from "../middlewares/role.middleware";
import { asyncHandler } from "../utils/asyncHandler";
import { createUser, deleteUser, listUsers, updateUser } from "../controllers/user.controller";

const router = Router();
router.use(authMiddleware, requireRoles(ADMIN_ROLE_ID));
router.get("/", asyncHandler(listUsers));
router.post("/", asyncHandler(createUser));
router.put("/:id", asyncHandler(updateUser));
router.delete("/:id", asyncHandler(deleteUser));

export default router;

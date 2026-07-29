import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { recoverPassword, refreshAccessToken, signIn } from "../controllers/auth.controller";

const router = Router();

router.post("/sign-in", asyncHandler(signIn));
router.post("/refresh-access-token", asyncHandler(refreshAccessToken));
router.post("/recover", asyncHandler(recoverPassword));

export default router;

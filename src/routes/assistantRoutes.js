import express from "express";
import { sendAssistantMessage } from "../controllers/assistantController.js";
import { asyncHandler } from "../middleware/errors.js";

const router = express.Router();

router.post("/messages", asyncHandler(sendAssistantMessage));

export default router;

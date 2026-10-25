import express from "express";
import {
  applyRebalance,
  createGoal,
  createUser,
  getProjections,
  getUser,
  getUserPlan,
  recommendPortfolio,
  saveRiskAssessment,
  simulateMarket,
  updateGoal,
  updateUserProfile,
} from "../controllers/planController.js";
import { asyncHandler } from "../middleware/errors.js";

const router = express.Router();

router.post("/users", asyncHandler(createUser));
router.get("/users/:userId", asyncHandler(getUser));
router.get("/users/:userId/plan", asyncHandler(getUserPlan));
router.put("/users/:userId/profile", asyncHandler(updateUserProfile));
router.post("/users/:userId/risk-assessments", asyncHandler(saveRiskAssessment));
router.post("/users/:userId/goals", asyncHandler(createGoal));
router.patch("/goals/:goalId", asyncHandler(updateGoal));
router.post("/portfolios/recommend", asyncHandler(recommendPortfolio));
router.post("/projections", asyncHandler(getProjections));
router.post("/portfolios/:portfolioId/simulate-market", asyncHandler(simulateMarket));
router.post("/portfolios/:portfolioId/rebalance/apply", asyncHandler(applyRebalance));

export default router;

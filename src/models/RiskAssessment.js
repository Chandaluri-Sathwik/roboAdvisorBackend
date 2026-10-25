import mongoose from "mongoose";

const riskAssessmentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    risk_tolerance: { type: String, enum: ["low", "moderate", "high"], required: true },
    risk_profile: {
      type: String,
      enum: ["Conservative", "Moderate", "Aggressive"],
      required: true,
    },
    unconstrained_risk_profile: {
      type: String,
      enum: ["Conservative", "Moderate", "Aggressive"],
      required: true,
    },
    goal_type: { type: String, required: true },
    horizon_years: { type: Number, required: true, min: 1, max: 100 },
    constraints: { type: mongoose.Schema.Types.Mixed, required: true },
    reasons: { type: [String], default: [] },
    warnings: { type: [String], default: [] },
  },
  { timestamps: true }
);

export default mongoose.model("RiskAssessment", riskAssessmentSchema);

import mongoose from "mongoose";

const allocationSchema = new mongoose.Schema(
  {
    equity: { type: Number, required: true, min: 0, max: 100 },
    debt: { type: Number, required: true, min: 0, max: 100 },
    commodity: { type: Number, required: true, min: 0, max: 100 },
  },
  { _id: false }
);

const portfolioSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    goal: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Goal",
      required: true,
      unique: true,
    },
    risk_profile: {
      type: String,
      enum: ["Conservative", "Moderate", "Aggressive"],
      required: true,
    },
    target_allocation: { type: allocationSchema, required: true },
    actual_allocation: { type: allocationSchema, required: true },
    current_value: { type: Number, required: true, min: 0 },
    has_simulated_market: { type: Boolean, default: false },
    recommendation_version: { type: String, required: true, default: "rules-v1" },
    recommendation_explanation: { type: String, required: true },
    market_data_context: { type: mongoose.Schema.Types.Mixed, default: null },
    investment_examples: { type: mongoose.Schema.Types.Mixed, default: null },
    investment_options: { type: mongoose.Schema.Types.Mixed, default: null },
    projection: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("Portfolio", portfolioSchema);

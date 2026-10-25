import mongoose from "mongoose";

const goalSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    goal_type: {
      type: String,
      enum: ["wealth_creation", "home", "education", "retirement", "other"],
      required: true,
    },
    horizon_years: { type: Number, required: true, min: 1, max: 100 },
    investment_type: { type: String, enum: ["one_time", "monthly"], required: true },
    initial_investment: { type: Number, required: true, min: 0 },
    monthly_contribution: { type: Number, required: true, min: 0 },
    expected_return_percent: { type: Number, required: true, min: 0, max: 100 },
  },
  { timestamps: true }
);

export default mongoose.model("Goal", goalSchema);

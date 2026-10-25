import mongoose from "mongoose";

const investableInstrumentSchema = new mongoose.Schema(
  {
    symbol: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    assetClass: {
      type: String,
      enum: ["equity", "debt", "commodity"],
      required: true,
    },
    instrumentType: {
      type: String,
      enum: ["stock", "mutualFund", "governmentBond", "bondFund", "commodityETF", "other"],
      required: true,
    },
    currency: { type: String, default: "INR" },
    exchange: { type: String, default: null },
    schemeCode: { type: String, default: null },
    underlyingAllocation: {
      equityPct: { type: Number, min: 0, max: 100, default: null },
      debtPct: { type: Number, min: 0, max: 100, default: null },
      commodityPct: { type: Number, min: 0, max: 100, default: null },
    },
    isInvestable: { type: Boolean, default: false },
    isVerified: { type: Boolean, default: false },
    verificationSource: { type: String, default: null },
    verifiedAt: { type: Date, default: null },
    metadataNotes: { type: String, default: "" },
  },
  { timestamps: true },
);

investableInstrumentSchema.index({ symbol: 1, instrumentType: 1 }, { unique: true });
investableInstrumentSchema.index({ assetClass: 1, isVerified: 1, isInvestable: 1 });

export default mongoose.model("InvestableInstrument", investableInstrumentSchema);

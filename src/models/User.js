import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    display_name: { type: String, required: true, trim: true, maxlength: 100 },
  },
  { timestamps: true }
);

export default mongoose.model("User", userSchema);

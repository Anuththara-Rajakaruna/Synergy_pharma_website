import { Schema } from "mongoose";
import { defineModel } from "@/models/shared";

export interface RateLimitDoc {
  // "<bucket>:<key>", e.g. "apply-ip:203.0.113.7".
  _id: string;
  count: number;
  windowStartedAt: Date;
  expiresAt: Date;
}

const rateLimitSchema = new Schema<RateLimitDoc>(
  {
    _id: { type: String, required: true, maxlength: 300 },
    count: { type: Number, required: true, default: 0 },
    windowStartedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
  },
  {
    collection: "rate_limits",
    timestamps: false,
    strict: "throw",
    strictQuery: "throw",
  }
);

rateLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "expiresAt_ttl" });

export const RateLimitModel = defineModel<RateLimitDoc>("RateLimit", rateLimitSchema);

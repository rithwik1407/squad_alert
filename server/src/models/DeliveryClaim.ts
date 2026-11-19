import { Schema, model } from 'mongoose';

/**
 * Short-lived lock: one row per (match, user, kind) while a delivery is in flight or after it succeeded.
 * The unique index makes the claim atomic across API and worker processes. Rows expire after a day.
 */
const claimSchema = new Schema({
  matchId: { type: Schema.Types.ObjectId, required: true },
  userId: { type: Schema.Types.ObjectId, required: true },
  kind: { type: String, required: true },
  expiresAt: { type: Date, required: true },
});
claimSchema.index({ matchId: 1, userId: 1, kind: 1 }, { unique: true });
claimSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const DeliveryClaim = model('DeliveryClaim', claimSchema);

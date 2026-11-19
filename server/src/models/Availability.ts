import { Schema, model } from 'mongoose';
import { AVAILABILITY } from './constants.js';

/**
 * A player's check-in for a match ("available / maybe / unavailable") before the captain picks,
 * and the "I'm joining" reply after the alert (joiningAt), from the app, the push action or Telegram.
 */
const availabilitySchema = new Schema(
  {
    matchId: { type: Schema.Types.ObjectId, ref: 'Match', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: AVAILABILITY, default: null },
    note: { type: String, default: '', maxlength: 80 },
    joiningAt: { type: Date, default: null },
    joiningVia: { type: String, default: null },
  },
  { timestamps: true },
);
availabilitySchema.index({ matchId: 1, userId: 1 }, { unique: true });
export const Availability = model('Availability', availabilitySchema);

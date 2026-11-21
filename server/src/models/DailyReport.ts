import { Schema, model } from 'mongoose';

/**
 * One row per (team, IST day) for the nightly Telegram summary. It makes the send idempotent:
 * `sentTo` remembers who already got it, `lockedUntil` stops two runs sending at once, and
 * `done` means nothing is left to do for that day (sent, or nothing was played).
 */
const dailyReportSchema = new Schema(
  {
    teamId: { type: Schema.Types.ObjectId, ref: 'Team', required: true },
    /** Report day as YYYY-MM-DD in the display time zone. */
    day: { type: String, required: true },
    sentTo: { type: [Schema.Types.ObjectId], default: [] },
    done: { type: Boolean, default: false },
    skipped: { type: Boolean, default: false },
    attempts: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    lastError: { type: String, default: null },
  },
  { timestamps: true },
);
dailyReportSchema.index({ teamId: 1, day: 1 }, { unique: true });
// Old rows are only useful for a while.
dailyReportSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 24 * 3600 });
export const DailyReport = model('DailyReport', dailyReportSchema);

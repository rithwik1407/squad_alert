import { Schema, model } from 'mongoose';

const statsSchema = new Schema(
  {
    matchId: { type: Schema.Types.ObjectId, ref: 'Match', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    /** Finishes (kills). */
    kills: { type: Number, default: 0, min: 0 },
    damage: { type: Number, default: 0, min: 0 },
    /** Minutes survived, from the results screen. Only used for the MVP score. */
    survivalMin: { type: Number, default: 0, min: 0 },
    /** Assists, used in place of knockouts (the results screen has no knockouts column). */
    assists: { type: Number, default: 0, min: 0 },
    mvp: { type: Boolean, default: false },
    mvpScore: { type: Number, default: 0 },
  },
  { timestamps: true },
);
statsSchema.index({ matchId: 1, userId: 1 }, { unique: true });
export const Stats = model('Stats', statsSchema);

import { Schema, model } from 'mongoose';

const statsSchema = new Schema(
  {
    matchId: { type: Schema.Types.ObjectId, ref: 'Match', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    kills: { type: Number, default: 0, min: 0 },
    damage: { type: Number, default: 0, min: 0 },
    mvp: { type: Boolean, default: false },
  },
  { timestamps: true },
);
statsSchema.index({ matchId: 1, userId: 1 }, { unique: true });
export const Stats = model('Stats', statsSchema);

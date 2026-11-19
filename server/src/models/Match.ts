import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { MAPS, MATCH_STATUS, MATCH_TYPES } from './constants.js';

const matchSchema = new Schema(
  {
    teamId: { type: Schema.Types.ObjectId, ref: 'Team', required: true, index: true },
    title: { type: String, required: true, trim: true },
    type: { type: String, enum: MATCH_TYPES, default: 'scrim' },
    map: { type: String, enum: MAPS, required: true },
    drop: { type: String, default: '' },
    /** Always UTC. */
    startAt: { type: Date, required: true, index: true },
    notifyOffsetMin: { type: Number, default: 2, min: 0, max: 120 },
    roomId: { type: String, default: '' },
    roomPassword: { type: String, default: '' },
    status: { type: String, enum: MATCH_STATUS, default: 'scheduled', index: true },
    /** Set when the squad notification went out. Squad edits lock from then on. */
    notifiedAt: { type: Date, default: null },
    /** Set when the worker fired but no squad was confirmed, so only the captain was alerted. */
    captainAlertedAt: { type: Date, default: null },
    tournamentName: { type: String, default: '' },
    placement: { type: Number, default: null },
  },
  { timestamps: true },
);

export type MatchAttrs = InferSchemaType<typeof matchSchema>;
export type MatchDoc = HydratedDocument<MatchAttrs>;
export const Match = model('Match', matchSchema);

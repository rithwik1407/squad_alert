import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { MAP_TBD, MATCH_MAPS, MATCH_STATUS, MATCH_TYPES } from './constants.js';

const matchSchema = new Schema(
  {
    teamId: { type: Schema.Types.ObjectId, ref: 'Team', required: true, index: true },
    title: { type: String, required: true, trim: true },
    type: { type: String, enum: MATCH_TYPES, default: 'scrim' },
    /** 'TBD' until the captain decides. */
    map: { type: String, enum: MATCH_MAPS, default: MAP_TBD },
    drop: { type: String, default: '' },
    /** Always UTC. */
    startAt: { type: Date, required: true, index: true },
    notifyOffsetMin: { type: Number, default: 2, min: 0, max: 120 },
    roomId: { type: String, default: '' },
    roomPassword: { type: String, default: '' },
    /** Our team's slot number in the custom room, e.g. "12". */
    slot: { type: String, default: '' },
    status: { type: String, enum: MATCH_STATUS, default: 'scheduled', index: true },
    /** Set when the squad notification went out. Squad edits lock from then on. */
    notifiedAt: { type: Date, default: null },
    /** Set when the worker fired but no squad was confirmed, so only the captain was alerted. */
    captainAlertedAt: { type: Date, default: null },
    tournamentName: { type: String, default: '' },
    placement: { type: Number, default: null },
    /** Matches created together (bulk add / daily repeat) share a batch id. */
    batchId: { type: String, default: null, index: true },
  },
  { timestamps: true },
);

export type MatchAttrs = InferSchemaType<typeof matchSchema>;
export type MatchDoc = HydratedDocument<MatchAttrs>;
export const Match = model('Match', matchSchema);

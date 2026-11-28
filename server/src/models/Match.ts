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
    /**
     * Players on the results screenshot who aren't on our team (a stand-in from outside). Kept on this match only:
     * they show on the match results with their numbers and their kills count toward the match points, but they
     * never get a user, a Stats row, a place in stats charts or on the team roster.
     */
    guests: {
      type: [new Schema({
        name: { type: String, required: true, trim: true, maxlength: 40 },
        kills: { type: Number, default: 0, min: 0 },
        damage: { type: Number, default: 0, min: 0 },
        survivalMin: { type: Number, default: 0, min: 0 },
        assists: { type: Number, default: 0, min: 0 },
      }, { _id: false })],
      default: [],
    },
  },
  { timestamps: true },
);
// Live sync (GET /api/team/pulse) reads the team's most recently changed match.
matchSchema.index({ teamId: 1, updatedAt: -1 });

export type MatchAttrs = InferSchemaType<typeof matchSchema>;
export type MatchDoc = HydratedDocument<MatchAttrs>;
export const Match = model('Match', matchSchema);

import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { TEAM_SIZE } from './constants.js';

const teamSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    tag: { type: String, default: '', trim: true },
    logo: { type: String, default: '' },
    captainId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    memberIds: {
      type: [{ type: Schema.Types.ObjectId, ref: 'User' }],
      default: [],
      validate: { validator: (v: unknown[]) => v.length <= TEAM_SIZE, message: `A team has at most ${TEAM_SIZE} players` },
    },
    joinCode: { type: String, required: true, unique: true, uppercase: true },
    /** Default drop spot per map, e.g. { Erangel: 'Quarry' }. */
    drops: { type: Map, of: String, default: {} },
    /** Bumped after any change to the team's matches, stats or squads. Apps poll it to refresh live. */
    liveRevAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export type TeamAttrs = InferSchemaType<typeof teamSchema>;
export type TeamDoc = HydratedDocument<TeamAttrs>;
export const Team = model('Team', teamSchema);

import { Schema, model, type InferSchemaType } from 'mongoose';

/**
 * waiting    → invite sent with a challenge; match not over yet
 * asking     → the squad was asked "Did the match begin?"
 * begun      → yes: now asking "Was the challenge completed?"
 * completed  → yes: everyone on it earned the badge
 * failed     → the match happened but the challenge wasn't done
 * not_played → the match never began
 * cancelled  → invite deleted, or nobody joined
 * expired    → nobody answered within a day
 */
export const CHALLENGE_STATUSES = ['waiting', 'asking', 'begun', 'completed', 'failed', 'not_played', 'cancelled', 'expired'] as const;
export type ChallengeStatus = (typeof CHALLENGE_STATUSES)[number];

const answerSchema = new Schema(
  { by: { type: Schema.Types.ObjectId, ref: 'User' }, at: Date, yes: Boolean },
  { _id: false },
);

/**
 * A challenge picked on a classic-match invite. It outlives the invite (which is gone after 7 minutes):
 * the players on it are the sender plus every teammate who said "I'm in".
 */
const runSchema = new Schema(
  {
    teamId: { type: Schema.Types.ObjectId, ref: 'Team', required: true, index: true },
    inviteId: { type: Schema.Types.ObjectId, ref: 'ClassicInvite', default: null, index: true },
    fromId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    challengeKey: { type: String, required: true },
    /** It was the team's daily challenge on the day it was picked. */
    daily: { type: Boolean, default: false },
    dayKey: { type: String, default: '' },
    /** Teammates the invite went to. */
    invitedIds: { type: [Schema.Types.ObjectId], default: [] },
    /** Who the match is for: the sender plus everyone who said "I'm in". These players answer and earn the badge. */
    playerIds: { type: [Schema.Types.ObjectId], default: [], index: true },
    status: { type: String, enum: CHALLENGE_STATUSES, default: 'waiting', index: true },
    /** When to ask "Did the match begin?". */
    askAt: { type: Date, required: true, index: true },
    askedAt: { type: Date, default: null },
    begun: { type: answerSchema, default: null },
    done: { type: answerSchema, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
runSchema.index({ teamId: 1, createdAt: -1 });

export type ChallengeRunAttrs = InferSchemaType<typeof runSchema>;
export const ChallengeRun = model('ChallengeRun', runSchema);

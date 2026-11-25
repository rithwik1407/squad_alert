import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

export const AI_PROPOSAL_KINDS = ['scrim', 'squad'] as const;
export const AI_PROPOSAL_STATUS = ['pending', 'approved', 'rejected', 'expired'] as const;

/**
 * An action the Squad AI prepared but did not carry out. Nothing changes in the team's data until the
 * captain approves it (POST /api/ai/proposals/:id/approve). Pending proposals expire after a day.
 */
const aiProposalSchema = new Schema(
  {
    teamId: { type: Schema.Types.ObjectId, ref: 'Team', required: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: AI_PROPOSAL_KINDS, required: true },
    /** scrim: the match fields to create. squad: { matchId, selectedIds }. */
    payload: { type: Schema.Types.Mixed, required: true },
    status: { type: String, enum: AI_PROPOSAL_STATUS, default: 'pending' },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    decidedAt: { type: Date, default: null },
    /** What approving created, e.g. the new match id. */
    resultId: { type: String, default: null },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);
aiProposalSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 7 * 24 * 3600 });

export type AiProposalAttrs = InferSchemaType<typeof aiProposalSchema>;
export type AiProposalDoc = HydratedDocument<AiProposalAttrs>;
export const AiProposal = model('AiProposal', aiProposalSchema);

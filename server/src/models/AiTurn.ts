import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

export const AI_TURN_STATUS = ['running', 'done', 'error', 'stopped'] as const;

/**
 * One question to the Squad AI and its answer, saved per teammate so the chat and its visuals survive
 * closing the app. Only the person who asked can read or delete it. Answers keep running on the server
 * after the app closes; the finished answer is here when they come back.
 */
const aiTurnSchema = new Schema(
  {
    teamId: { type: Schema.Types.ObjectId, ref: 'Team', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    /** Turns of one chat share this id; "New chat" starts a fresh one. */
    conversationId: { type: String, required: true },
    question: { type: String, required: true },
    text: { type: String, default: '' },
    tools: { type: [{ _id: false, id: String, label: String, status: String, ms: Number }], default: [] },
    blocks: { type: [Schema.Types.Mixed], default: [] },
    notice: { type: String, default: null },
    engine: { type: String, default: null },
    label: { type: String, default: null },
    model: { type: String, default: null },
    status: { type: String, enum: AI_TURN_STATUS, default: 'running' },
    finishedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
aiTurnSchema.index({ userId: 1, createdAt: -1 });
aiTurnSchema.index({ userId: 1, conversationId: 1, createdAt: 1 });

export type AiTurnAttrs = InferSchemaType<typeof aiTurnSchema>;
export type AiTurnDoc = HydratedDocument<AiTurnAttrs>;
export const AiTurn = model('AiTurn', aiTurnSchema);

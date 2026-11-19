import { Schema, model, type InferSchemaType } from 'mongoose';
import { CHANNELS, LOG_KINDS, LOG_STATUS } from './constants.js';

const logSchema = new Schema(
  {
    matchId: { type: Schema.Types.ObjectId, ref: 'Match', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    kind: { type: String, enum: LOG_KINDS, default: 'squad' },
    channel: { type: String, enum: CHANNELS, required: true },
    status: { type: String, enum: LOG_STATUS, required: true },
    trigger: { type: String, default: 'scheduled' },
    title: { type: String, default: '' },
    body: { type: String, default: '' },
    sentAt: { type: Date, default: () => new Date() },
    error: { type: String, default: null },
  },
  { timestamps: true },
);

// Hard guarantee against duplicates: only one "sent" row per (match, user, kind).
logSchema.index(
  { matchId: 1, userId: 1, kind: 1 },
  { unique: true, partialFilterExpression: { status: 'sent' }, name: 'one_sent_per_user' },
);

export type NotificationLogAttrs = InferSchemaType<typeof logSchema>;
export const NotificationLog = model('NotificationLog', logSchema);

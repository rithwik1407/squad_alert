import { Schema, model, type InferSchemaType } from 'mongoose';

/** What kind of phone notification an inbox item copies. */
export const INBOX_KINDS = ['squad', 'captain_alert', 'selected', 'results', 'room', 'invite', 'ai_message'] as const;
export type InboxKind = (typeof INBOX_KINDS)[number];
/** Inbox items are removed automatically this long after they arrive. */
export const INBOX_TTL_DAYS = 30;

/**
 * One row per member per notification sent to their phone. Deleting removes only this member's copy;
 * the captain's delivery log (NotificationLog) is separate and untouched.
 */
const inboxSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: INBOX_KINDS, required: true },
    title: { type: String, default: '' },
    body: { type: String, default: '' },
    /** Path inside the app that opens when the item is tapped. */
    url: { type: String, default: '/' },
    matchId: { type: Schema.Types.ObjectId, ref: 'Match', default: null },
    readAt: { type: Date, default: null },
  },
  { timestamps: true },
);

inboxSchema.index({ userId: 1, createdAt: -1 });
inboxSchema.index({ userId: 1, matchId: 1, kind: 1 });
inboxSchema.index({ createdAt: 1 }, { expireAfterSeconds: INBOX_TTL_DAYS * 24 * 3600, name: 'inbox_ttl' });

export type InboxItemAttrs = InferSchemaType<typeof inboxSchema>;
export const InboxItem = model('InboxItem', inboxSchema);

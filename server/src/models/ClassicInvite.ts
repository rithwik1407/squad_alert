import { Schema, model, type InferSchemaType } from 'mongoose';

export const INVITE_RESPONSES = ['in', 'out'] as const;
export type InviteResponse = (typeof INVITE_RESPONSES)[number];

/**
 * "Can we play a classic match?" A player picks teammates and writes a line; each gets an app push and a
 * Telegram message with I'm in / I'm out buttons. Answers are stored here. An invite lives for 7 minutes:
 * after that it is hidden everywhere, its Telegram messages are deleted, and MongoDB removes it soon after.
 */
const inviteSchema = new Schema(
  {
    teamId: { type: Schema.Types.ObjectId, ref: 'Team', required: true, index: true },
    fromId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    message: { type: String, default: '', trim: true, maxlength: 300 },
    recipients: {
      type: [{
        _id: false,
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        response: { type: String, enum: [...INVITE_RESPONSES, null], default: null },
        respondedAt: { type: Date, default: null },
        /** Where they answered: app, push or telegram. */
        via: { type: String, default: null },
        /** Channels the invite reached them on. */
        delivered: { type: [String], default: [] },
        /** The Telegram message holding the invite, so it can be deleted when the invite runs out. */
        tgMessageId: { type: Number, default: null },
      }],
      default: [],
    },
    /** When MongoDB removes the invite: a little after it runs out, so its Telegram messages can be cleaned up first. */
    expireAt: { type: Date, default: null },
    /** True once its Telegram messages were deleted. */
    tgCleared: { type: Boolean, default: false },
  },
  { timestamps: true },
);
inviteSchema.index({ createdAt: 1 }, { expireAfterSeconds: 3 * 24 * 3600 });
inviteSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

export type InviteAttrs = InferSchemaType<typeof inviteSchema>;
export const ClassicInvite = model('ClassicInvite', inviteSchema);

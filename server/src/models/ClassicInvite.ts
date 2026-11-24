import { Schema, model, type InferSchemaType } from 'mongoose';

export const INVITE_RESPONSES = ['in', 'out'] as const;
export type InviteResponse = (typeof INVITE_RESPONSES)[number];

/**
 * "Can we play a classic match?" A player picks teammates and writes a line; each gets an app push and a
 * Telegram message with I'm in / I'm out buttons. Answers are stored here. Old invites expire after 3 days.
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
      }],
      default: [],
    },
  },
  { timestamps: true },
);
inviteSchema.index({ createdAt: 1 }, { expireAfterSeconds: 3 * 24 * 3600 });

export type InviteAttrs = InferSchemaType<typeof inviteSchema>;
export const ClassicInvite = model('ClassicInvite', inviteSchema);

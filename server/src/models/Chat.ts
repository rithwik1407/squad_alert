import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

export const CHAT_MODES = ['always', 'hours', 'closed'] as const;
export type ChatMode = (typeof CHAT_MODES)[number];

/** One message in a team's group chat. */
const chatMessageSchema = new Schema(
  {
    teamId: { type: Schema.Types.ObjectId, ref: 'Team', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    text: { type: String, required: true, maxlength: 1000 },
    /** System notes such as "Admin muted X for 1 hour". */
    system: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
chatMessageSchema.index({ teamId: 1, createdAt: -1 });

export type ChatMessageAttrs = InferSchemaType<typeof chatMessageSchema>;
export const ChatMessage = model('ChatMessage', chatMessageSchema);

/** Per-team chat rules set by the admin: open hours and muted players. */
const chatSettingsSchema = new Schema(
  {
    teamId: { type: Schema.Types.ObjectId, ref: 'Team', required: true, unique: true },
    mode: { type: String, enum: CHAT_MODES, default: 'always' },
    /** "HH:MM" in the display time zone. If end < start the window runs past midnight. */
    openFrom: { type: String, default: '18:00' },
    openTo: { type: String, default: '23:59' },
    mutes: {
      type: [new Schema({ userId: { type: Schema.Types.ObjectId, ref: 'User' }, until: Date, at: Date }, { _id: false })],
      default: [],
    },
  },
  { timestamps: true },
);

export type ChatSettingsAttrs = InferSchemaType<typeof chatSettingsSchema>;
export type ChatSettingsDoc = HydratedDocument<ChatSettingsAttrs>;
export const ChatSettings = model('ChatSettings', chatSettingsSchema);

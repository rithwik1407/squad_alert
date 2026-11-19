import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { ROLES } from './constants.js';

const notifyPrefsSchema = new Schema(
  {
    push: { type: Boolean, default: true },
    telegram: { type: Boolean, default: true },
    whatsapp: { type: Boolean, default: true },
  },
  { _id: false },
);

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    ign: { type: String, required: true, trim: true },
    bgmiId: { type: String, trim: true, default: '' },
    role: { type: String, enum: ROLES, default: 'player' },
    avatar: { type: String, default: '' },
    teamId: { type: Schema.Types.ObjectId, ref: 'Team', default: null },
    fcmTokens: { type: [String], default: [] },
    telegramChatId: { type: String, default: null },
    telegramLinkToken: { type: String, default: null, index: true },
    whatsappNumber: { type: String, default: null },
    notifyPrefs: { type: notifyPrefsSchema, default: () => ({}) },
  },
  { timestamps: true },
);

userSchema.set('toJSON', {
  transform: (_doc, ret: Record<string, unknown>) => {
    delete ret.passwordHash;
    delete ret.telegramLinkToken;
    delete ret.__v;
    ret.telegramLinked = Boolean(ret.telegramChatId);
    ret.whatsappLinked = Boolean(ret.whatsappNumber);
    ret.pushEnabled = Array.isArray(ret.fcmTokens) && ret.fcmTokens.length > 0;
    delete ret.fcmTokens;
    delete ret.telegramChatId;
    return ret;
  },
});

export type UserAttrs = InferSchemaType<typeof userSchema>;
export type UserDoc = HydratedDocument<UserAttrs>;
export const User = model('User', userSchema);

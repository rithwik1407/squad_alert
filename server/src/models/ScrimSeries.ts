import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

/**
 * Organizer contact card for one scrim / tournament series (e.g. "EG Daily Scrims"):
 * where to find them on Discord and who to message. Matches link to it by their tournamentName.
 */
const scrimSeriesSchema = new Schema(
  {
    teamId: { type: Schema.Types.ObjectId, ref: 'Team', required: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    /** seriesKey(name): lower-case letters and digits only, used for matching. */
    key: { type: String, required: true },
    organizer: { type: String, default: '', trim: true, maxlength: 80 },
    /** Discord server invite, e.g. https://discord.gg/abc */
    discordInvite: { type: String, default: '' },
    /** Direct link to the channel where room IDs / slot lists are posted. */
    discordChannel: { type: String, default: '' },
    /** Discord handle, WhatsApp, phone, Instagram... free text. */
    contact: { type: String, default: '', trim: true, maxlength: 200 },
    notes: { type: String, default: '', trim: true, maxlength: 1000 },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);
scrimSeriesSchema.index({ teamId: 1, key: 1 }, { unique: true });

export type ScrimSeriesAttrs = InferSchemaType<typeof scrimSeriesSchema>;
export type ScrimSeriesDoc = HydratedDocument<ScrimSeriesAttrs>;
export const ScrimSeries = model('ScrimSeries', scrimSeriesSchema);

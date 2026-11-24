import { Schema, model } from 'mongoose';

/** The results screenshot uploaded for a match (latest one), kept so the team can look at it again later. */
const matchScreenshotSchema = new Schema(
  {
    matchId: { type: Schema.Types.ObjectId, ref: 'Match', required: true, unique: true },
    /** Shrunk JPEG as a data URL (the app resizes to about 1600px wide before upload). */
    image: { type: String, required: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);
export const MatchScreenshot = model('MatchScreenshot', matchScreenshotSchema);

import { Schema, model } from 'mongoose';

const attendanceSchema = new Schema(
  {
    matchId: { type: Schema.Types.ObjectId, ref: 'Match', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    joined: { type: Boolean, required: true },
  },
  { timestamps: true },
);
attendanceSchema.index({ matchId: 1, userId: 1 }, { unique: true });
export const Attendance = model('Attendance', attendanceSchema);

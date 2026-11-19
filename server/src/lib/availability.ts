import { Types } from 'mongoose';
import { Availability, Squad } from '../models/index.js';

/** Record "I'm joining" for a selected player. Returns false if they aren't in the confirmed squad. */
export async function markJoining(matchId: string, userId: string, via: 'app' | 'push' | 'telegram') {
  const inSquad = await Squad.exists({ matchId: new Types.ObjectId(matchId), confirmed: true, selectedIds: new Types.ObjectId(userId) });
  if (!inSquad) return false;
  await Availability.updateOne(
    { matchId, userId, joiningAt: null },
    { $set: { joiningAt: new Date(), joiningVia: via } },
    { upsert: false },
  );
  // Upsert separately so an existing joiningAt is never overwritten.
  await Availability.updateOne(
    { matchId, userId },
    { $setOnInsert: { joiningAt: new Date(), joiningVia: via, status: 'available' } },
    { upsert: true },
  );
  return true;
}

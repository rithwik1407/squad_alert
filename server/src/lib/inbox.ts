import { Types } from 'mongoose';
import { InboxItem, type InboxKind } from '../models/index.js';

export interface InboxEntry {
  kind: InboxKind;
  title: string;
  body: string;
  url?: string;
  /** Match alerts: one item per (member, match, kind). A newer one replaces the older (room updates, retries). */
  matchId?: string | null;
}

const oid = (id: string) => new Types.ObjectId(id);

/**
 * Copy a notification into each member's Inbox. Called next to every push send, whether or not the phone got it,
 * so nobody misses an alert. Never throws: a failed save must not block the alert itself.
 */
export async function saveToInbox(userIds: string[], entry: InboxEntry): Promise<void> {
  const ids = [...new Set(userIds)].filter((id) => Types.ObjectId.isValid(id));
  if (!ids.length) return;
  const base = { kind: entry.kind, title: entry.title, body: entry.body, url: entry.url || '/' };
  try {
    if (entry.matchId && Types.ObjectId.isValid(entry.matchId)) {
      const matchId = oid(entry.matchId);
      // Same match + kind replaces the member's older copy (and shows it as new again).
      await InboxItem.bulkWrite(ids.map((id) => ({
        updateOne: {
          filter: { userId: oid(id), matchId, kind: entry.kind },
          update: { $set: { ...base, readAt: null, createdAt: new Date() }, $setOnInsert: { userId: oid(id), matchId } },
          upsert: true,
          timestamps: false,
        },
      })));
    } else {
      await InboxItem.insertMany(ids.map((id) => ({ ...base, userId: oid(id), matchId: null })));
    }
  } catch (e) {
    console.error('[inbox] save failed:', (e as Error).message);
  }
}

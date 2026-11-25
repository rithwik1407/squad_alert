import { Router } from 'express';
import { Types } from 'mongoose';
import { ah } from '../middleware/handlers.js';
import { requireAuth } from '../middleware/auth.js';
import { InboxItem } from '../models/index.js';
import { notFound } from '../lib/errors.js';

/** Each member's own copies of the notifications sent to them. Every route only ever touches the caller's items. */
export const inboxRouter = Router();
inboxRouter.use(requireAuth);

const serialize = (i: { _id: unknown; kind: string; title?: string | null; body?: string | null; url?: string | null; matchId?: unknown; readAt?: Date | null; createdAt: Date }) => ({
  id: String(i._id),
  kind: i.kind,
  title: i.title ?? '',
  body: i.body ?? '',
  url: i.url || '/',
  matchId: i.matchId ? String(i.matchId) : null,
  read: Boolean(i.readAt),
  createdAt: i.createdAt,
});

inboxRouter.get('/', ah(async (req, res) => {
  const userId = req.user!._id;
  const limit = Math.min(Math.max(Number(req.query.limit ?? 100) || 100, 1), 300);
  const [items, unread] = await Promise.all([
    InboxItem.find({ userId }).sort({ createdAt: -1 }).limit(limit).lean(),
    InboxItem.countDocuments({ userId, readAt: null }),
  ]);
  res.json({ items: items.map(serialize), unread });
}));

/** Opening the Inbox marks everything read. */
inboxRouter.post('/read', ah(async (req, res) => {
  await InboxItem.updateMany({ userId: req.user!._id, readAt: null }, { $set: { readAt: new Date() } });
  res.json({ ok: true });
}));

inboxRouter.delete('/:id', ah(async (req, res) => {
  if (!Types.ObjectId.isValid(req.params.id)) throw notFound('Notification not found');
  const r = await InboxItem.deleteOne({ _id: req.params.id, userId: req.user!._id });
  if (!r.deletedCount) throw notFound('Notification not found');
  res.json({ ok: true });
}));

/** Clear all of your own items (never a teammate's). */
inboxRouter.delete('/', ah(async (req, res) => {
  const r = await InboxItem.deleteMany({ userId: req.user!._id });
  res.json({ ok: true, deleted: r.deletedCount });
}));

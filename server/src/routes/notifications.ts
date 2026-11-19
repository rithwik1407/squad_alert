import { Router } from 'express';
import { ah } from '../middleware/handlers.js';
import { requireAuth } from '../middleware/auth.js';
import { Match, NotificationLog } from '../models/index.js';
import { serializeLog } from './matches.js';

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

/** Captain: every attempt for the team. Player: their own delivered notifications (the inbox). */
notificationsRouter.get('/', ah(async (req, res) => {
  const user = req.user!;
  const limit = Math.min(Number(req.query.limit ?? 100), 300);
  let filter: Record<string, unknown>;
  if (user.role === 'captain') {
    const ids = await Match.find({ teamId: user.teamId }).distinct('_id');
    filter = { matchId: { $in: ids } };
  } else {
    filter = { userId: user._id, status: 'sent' };
  }
  const logs = await NotificationLog.find(filter)
    .sort({ sentAt: -1 })
    .limit(limit)
    .populate('userId', 'name ign')
    .populate('matchId', 'title map startAt')
    .lean();
  res.json({ logs: logs.map(serializeLog) });
}));

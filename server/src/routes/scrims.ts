import { Router, type Request } from 'express';
import { z } from 'zod';
import { ah, parse } from '../middleware/handlers.js';
import { requireAuth } from '../middleware/auth.js';
import { isAdmin, Match, ScrimSeries } from '../models/index.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { normalizeLink, seriesKey } from '../lib/seriesName.js';

/**
 * Scrim organizer contacts: Discord links and organizer details per scrim/tournament series.
 * Everyone on the team can read them; the captain or the admin edits them.
 */
export const scrimsRouter = Router();
scrimsRouter.use(requireAuth);

function teamIdOf(req: Request) {
  const id = req.user!.teamId;
  if (!id) throw notFound('You are not on a team yet');
  return id;
}

const canEdit = (req: Request) => isAdmin(req.user) || req.user?.role === 'captain';

function requireEditor(req: Request, _res: unknown, next: (e?: unknown) => void) {
  if (!canEdit(req)) return next(forbidden('Only the captain or admin can change organizer contacts'));
  next();
}

const link = z.string().max(300).optional().transform((v, ctx) => {
  try {
    return normalizeLink(v);
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'That does not look like a link. Paste the full Discord link.' });
    return z.NEVER;
  }
});

const body = z.object({
  name: z.string().trim().min(1, 'Give the scrim series a name').max(60, 'Keep the name under 60 characters'),
  organizer: z.string().trim().max(80).optional().default(''),
  discordInvite: link,
  discordChannel: link,
  contact: z.string().trim().max(200).optional().default(''),
  notes: z.string().trim().max(1000).optional().default(''),
});

type SeriesLean = {
  _id: unknown; name: string; organizer?: string | null; discordInvite?: string | null; discordChannel?: string | null;
  contact?: string | null; notes?: string | null; updatedAt?: Date | null;
};

function serialize(s: SeriesLean, matchCount = 0) {
  return {
    id: String(s._id),
    name: s.name,
    key: seriesKey(s.name),
    organizer: s.organizer ?? '',
    discordInvite: s.discordInvite ?? '',
    discordChannel: s.discordChannel ?? '',
    contact: s.contact ?? '',
    notes: s.notes ?? '',
    updatedAt: s.updatedAt ?? null,
    matchCount,
  };
}

/** Saved contacts, plus series names used on matches that don't have a contact yet. */
scrimsRouter.get('/', ah(async (req, res) => {
  const teamId = teamIdOf(req);
  const [series, names] = await Promise.all([
    ScrimSeries.find({ teamId }).sort({ name: 1 }).lean(),
    Match.aggregate<{ _id: string; count: number; last: Date }>([
      { $match: { teamId, tournamentName: { $nin: ['', null] } } },
      { $group: { _id: '$tournamentName', count: { $sum: 1 }, last: { $max: '$startAt' } } },
    ]),
  ]);
  const counts = new Map<string, { name: string; count: number; last: number }>();
  for (const n of names) {
    const k = seriesKey(n._id);
    if (!k) continue;
    const prev = counts.get(k);
    const last = new Date(n.last).getTime();
    if (!prev) counts.set(k, { name: n._id, count: n.count, last });
    else {
      prev.count += n.count;
      if (last > prev.last) { prev.name = n._id; prev.last = last; }
    }
  }
  const saved = new Set(series.map((s) => s.key));
  res.json({
    canEdit: canEdit(req),
    series: series.map((s) => serialize(s, counts.get(s.key)?.count ?? 0)),
    unsaved: [...counts.entries()]
      .filter(([k]) => !saved.has(k))
      .sort((a, b) => b[1].last - a[1].last)
      .slice(0, 20)
      .map(([, v]) => ({ name: v.name, matchCount: v.count })),
  });
}));

scrimsRouter.post('/', requireEditor, ah(async (req, res) => {
  const teamId = teamIdOf(req);
  const b = parse(body, req.body);
  const key = seriesKey(b.name);
  if (!key) throw badRequest('Give the scrim series a name with letters or numbers');
  if (await ScrimSeries.exists({ teamId, key })) throw conflict(`"${b.name}" is already saved. Edit that card instead.`);
  const s = await ScrimSeries.create({ ...b, teamId, key, updatedBy: req.user!._id });
  res.status(201).json({ series: serialize(s.toObject()) });
}));

scrimsRouter.patch('/:id', requireEditor, ah(async (req, res) => {
  const teamId = teamIdOf(req);
  const b = parse(body, req.body);
  const key = seriesKey(b.name);
  if (!key) throw badRequest('Give the scrim series a name with letters or numbers');
  const s = await ScrimSeries.findOne({ _id: String(req.params.id), teamId });
  if (!s) throw notFound('That organizer card is gone');
  if (key !== s.key && (await ScrimSeries.exists({ teamId, key }))) throw conflict(`"${b.name}" is already saved as another card`);
  s.set({ ...b, key, updatedBy: req.user!._id });
  await s.save();
  res.json({ series: serialize(s.toObject()) });
}));

scrimsRouter.delete('/:id', requireEditor, ah(async (req, res) => {
  const r = await ScrimSeries.deleteOne({ _id: String(req.params.id), teamId: teamIdOf(req) });
  if (!r.deletedCount) throw notFound('That organizer card is already gone');
  res.json({ ok: true });
}));

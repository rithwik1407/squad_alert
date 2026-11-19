/**
 * Seed: Team RARE (1 captain + 5 players) and sample matches.
 * Run: npm run seed            (wipes the users/teams/matches it creates, then re-creates them)
 * All seeded accounts use the password in SEED_PASSWORD (default "squadsync123").
 * Discord handles were provided for reference only; SquadSync never uses Discord.
 */
import bcrypt from 'bcryptjs';
import { connectDb, disconnectDb } from './lib/db.js';
import { Attendance, Match, NotificationLog, Squad, Stats, Team, User } from './models/index.js';
import { Redis } from 'ioredis';
import { config } from './config.js';
import { getQueue, closeQueue } from './scheduler/bull.js';
import { upsertMatchJob } from './scheduler/queue.js';

const PASSWORD = process.env.SEED_PASSWORD ?? 'squadsync123';

const captain = { name: 'Vivek Reddy', email: 'captain@teamrare.gg', ign: 'RARE丨CAPTAIN', bgmiId: '' };
const players = [
  { name: 'Akshay', email: 'akshay@teamrare.gg', ign: 'RARE丨AKSHAY', bgmiId: '5577363210' },
  { name: 'Dheeraj', email: 'dheeraj@teamrare.gg', ign: 'RARE丨DHEERAJ33', bgmiId: '5688639254' },
  { name: 'Bittu', email: 'bittu@teamrare.gg', ign: 'RARE丨BITTU', bgmiId: '5758878717' },
  { name: 'Vasanth', email: 'vasanth@teamrare.gg', ign: 'RARE丨VASANTH', bgmiId: '5781100224' },
  { name: 'Vignesh', email: 'vignesh@teamrare.gg', ign: 'RARE丨VIGNESH', bgmiId: '55522353757' },
];

const DROPS = { Erangel: 'Quarry', Miramar: 'Monte', Sanhok: 'Ruins' };

/** A Date for "today + dayOffset at hh:mm" in Asia/Kolkata. */
function ist(dayOffset: number, hh: number, mm = 0) {
  const nowIst = new Date(Date.now() + 5.5 * 3600_000);
  const y = nowIst.getUTCFullYear(), mo = nowIst.getUTCMonth(), d = nowIst.getUTCDate() + dayOffset;
  return new Date(Date.UTC(y, mo, d, hh, mm) - 5.5 * 3600_000);
}

async function redisReachable() {
  const r = new Redis(config.redisUrl, { lazyConnect: true, connectTimeout: 3000, maxRetriesPerRequest: 0, retryStrategy: () => null });
  try { await r.connect(); await r.ping(); return true; } catch { return false; } finally { r.disconnect(); }
}

async function main() {
  await connectDb();
  const emails = [captain, ...players].map((p) => p.email);
  const old = await User.find({ email: { $in: emails } }).lean();
  const oldTeam = await Team.findOne({ name: 'TEAM RARE' }).lean();
  if (oldTeam) {
    const matchIds = await Match.find({ teamId: oldTeam._id }).distinct('_id');
    await Promise.all([
      Squad.deleteMany({ matchId: { $in: matchIds } }),
      NotificationLog.deleteMany({ matchId: { $in: matchIds } }),
      Attendance.deleteMany({ matchId: { $in: matchIds } }),
      Stats.deleteMany({ matchId: { $in: matchIds } }),
      Match.deleteMany({ teamId: oldTeam._id }),
      Team.deleteOne({ _id: oldTeam._id }),
    ]);
  }
  await User.deleteMany({ _id: { $in: old.map((u) => u._id) } });

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const cap = await User.create({ ...captain, passwordHash, role: 'captain' });
  const ps = await User.insertMany(players.map((p) => ({ ...p, passwordHash, role: 'player' })));
  const team = await Team.create({
    name: 'TEAM RARE', tag: 'RARE', captainId: cap._id, memberIds: ps.map((p) => p._id), joinCode: 'RARE25', drops: DROPS,
  });
  await User.updateMany({ _id: { $in: [cap._id, ...ps.map((p) => p._id)] } }, { $set: { teamId: team._id } });

  const [akshay, dheeraj, bittu, vasanth, vignesh] = ps;
  const redisOk = await redisReachable();
  if (!redisOk) console.warn('[seed] Redis not reachable: matches are saved but alerts are not scheduled. Re-save them in the app once Redis is up.');
  const queue = redisOk ? getQueue() : null;

  // Upcoming
  const upcoming = [
    { title: 'Scrim 1', type: 'scrim', map: 'Erangel', startAt: ist(0, 21, 0), roomId: '4471823', roomPassword: 'rare21' },
    { title: 'Scrim 2', type: 'scrim', map: 'Miramar', startAt: ist(0, 22, 0), roomId: '', roomPassword: '' },
    { title: 'Scrim 3', type: 'scrim', map: 'Sanhok', startAt: ist(1, 21, 0), roomId: '', roomPassword: '' },
    { title: 'BGIS Qualifier R1', type: 'tournament', map: 'Erangel', startAt: ist(2, 18, 30), tournamentName: 'BGIS 2026' },
  ];
  for (const u of upcoming) {
    if (u.startAt.getTime() < Date.now() + 5 * 60_000) u.startAt = new Date(u.startAt.getTime() + 24 * 3600_000);
    const m = await Match.create({ ...u, teamId: team._id, drop: DROPS[u.map as keyof typeof DROPS] ?? '' });
    if (u.title === 'Scrim 1') {
      await Squad.create({ matchId: m._id, selectedIds: [akshay._id, dheeraj._id, bittu._id, vasanth._id], benchedId: vignesh._id, confirmed: true });
    }
    if (queue) await upsertMatchJob(queue, { id: String(m._id), ...m.toObject() });
  }

  // History with stats so charts have data
  const maps = ['Erangel', 'Miramar', 'Sanhok', 'Erangel', 'Sanhok', 'Miramar'] as const;
  for (let i = 0; i < maps.length; i++) {
    const startAt = ist(-(maps.length - i), 21, 0);
    const m = await Match.create({
      teamId: team._id, title: `Scrim ${i + 1}`, type: 'scrim', map: maps[i], drop: DROPS[maps[i]],
      startAt, status: 'done', notifiedAt: new Date(startAt.getTime() - 2 * 60_000), placement: [3, 1, 7, 2, 5, 1][i],
    });
    const bench = ps[i % 5];
    const squad = ps.filter((p) => p !== bench);
    await Squad.create({ matchId: m._id, selectedIds: squad.map((p) => p._id), benchedId: bench._id, confirmed: true });
    const mvpIdx = i % 4;
    for (const [j, p] of squad.entries()) {
      await Stats.create({ matchId: m._id, userId: p._id, kills: ((i + 2) * (j + 3)) % 9 + 1, damage: 180 + ((i * 97 + j * 131) % 620), mvp: j === mvpIdx });
      await Attendance.create({ matchId: m._id, userId: p._id, joined: !(i === 2 && j === 1) });
      await NotificationLog.create({
        matchId: m._id, userId: p._id, kind: 'squad', channel: j === 3 ? 'telegram' : 'fcm', status: 'sent',
        title: 'Match in 2 minutes!', body: `Scrim ${i + 1} · ${maps[i]} · 9:00 PM. Join the lobby now.`,
        sentAt: new Date(startAt.getTime() - 2 * 60_000),
      });
    }
  }

  console.log('\nSeeded TEAM RARE (join code RARE25)');
  console.log(`  captain  ${captain.email} / ${PASSWORD}`);
  for (const p of players) console.log(`  player   ${p.email} / ${PASSWORD}  (${p.ign})`);
  await closeQueue();
  await disconnectDb();
}

main().catch(async (e) => {
  console.error(e);
  await disconnectDb();
  process.exit(1);
});

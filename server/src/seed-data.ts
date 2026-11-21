/**
 * TEAM RARE seed data. Used by `npm run seed` (seed.ts) and by the server on startup when SEED_TEAM_RARE=true.
 * Seed: Team RARE (1 captain + 5 players). No sample matches.
 * Run: npm run seed            (wipes the users/teams/matches it creates, then re-creates them)
 * All seeded accounts use the password "rare@123". Captain: admin@rare.com, players: <name>@rare.com.
 * Discord handles were provided for reference only; SquadSync never uses Discord.
 */
import bcrypt from 'bcryptjs';
import { deleteMatchesFor } from './scripts/clearMatches.js';
import { Team, User } from './models/index.js';

const PASSWORD = 'rare@123';

// Emails used by older versions of this seed, removed so they don't linger.
const OLD_EMAILS = ['captain', 'akshay', 'dheeraj', 'bittu', 'vasanth', 'vignesh'].map((n) => `${n}@teamrare.gg`);

const captain = { name: 'Vivek Reddy', email: 'admin@rare.com', ign: 'RARE丨CAPTAIN', bgmiId: '' };
const players = [
  { name: 'Akshay', email: 'akshay@rare.com', ign: 'RARE丨AKSHAY', bgmiId: '5577363210' },
  { name: 'Dheeraj', email: 'dheeraj@rare.com', ign: 'RARE丨DHEERAJ33', bgmiId: '5688639254' },
  { name: 'Bittu', email: 'bittu@rare.com', ign: 'RARE丨BITTU', bgmiId: '5758878717' },
  { name: 'Vasanth', email: 'vasanth@rare.com', ign: 'RARE丨VASANTH', bgmiId: '5781100224' },
  { name: 'Vignesh', email: 'vignesh@rare.com', ign: 'RARE丨VIGNESH', bgmiId: '55522353757' },
];

const DROPS = { Erangel: 'Quarry', Miramar: 'Monte', Rondo: 'Jadena City' };

export interface SeedOptions {
  /** true: delete the seeded users/team (and their matches) first. false: do nothing if the captain already exists. */
  wipe: boolean;
}

/** Create TEAM RARE. Assumes the DB is connected. Returns false when it skipped because the team already exists. */
export async function seedTeamRare({ wipe }: SeedOptions): Promise<boolean> {
  if (!wipe && (await User.exists({ email: captain.email }))) return false;
  const emails = [...[captain, ...players].map((p) => p.email), ...OLD_EMAILS];
  const old = await User.find({ email: { $in: emails } }).lean();
  const oldTeam = await Team.findOne({ name: 'TEAM RARE' }).lean();
  if (oldTeam) {
    await deleteMatchesFor({ teamId: oldTeam._id });
    await Team.deleteOne({ _id: oldTeam._id });
  }
  await User.deleteMany({ _id: { $in: old.map((u) => u._id) } });

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const cap = await User.create({ ...captain, passwordHash, role: 'captain' });
  const ps = await User.insertMany(players.map((p) => ({ ...p, passwordHash, role: 'player' })));
  const team = await Team.create({
    name: 'TEAM RARE', tag: 'RARE', captainId: cap._id, memberIds: ps.map((p) => p._id), joinCode: 'RARE25', drops: DROPS,
  });
  await User.updateMany({ _id: { $in: [cap._id, ...ps.map((p) => p._id)] } }, { $set: { teamId: team._id } });

  // No sample matches: the captain adds real ones from the app. (Use `npm run clear-matches` to wipe matches later.)
  console.log('\nSeeded TEAM RARE (join code RARE25), no matches');
  console.log(`  captain  ${captain.email} / ${PASSWORD}`);
  for (const p of players) console.log(`  player   ${p.email} / ${PASSWORD}  (${p.ign})`);
  return true;
}

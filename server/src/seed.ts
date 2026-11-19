/**
 * Seed: Team RARE (1 captain + 5 players). No sample matches.
 * Run: npm run seed            (wipes the users/teams/matches it creates, then re-creates them)
 * All seeded accounts use the password in SEED_PASSWORD (default "squadsync123").
 * Discord handles were provided for reference only; SquadSync never uses Discord.
 */
import bcrypt from 'bcryptjs';
import { connectDb, disconnectDb } from './lib/db.js';
import { deleteMatchesFor } from './scripts/clearMatches.js';
import { Team, User } from './models/index.js';

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

async function main() {
  await connectDb();
  const emails = [captain, ...players].map((p) => p.email);
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
  await disconnectDb();
}

main().catch(async (e) => {
  console.error(e);
  await disconnectDb();
  process.exit(1);
});

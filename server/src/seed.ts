/**
 * Seed: Team RARE (1 captain + 5 players). No sample matches.
 * Run: npm run seed   (wipes the users/teams/matches it creates, then re-creates them)
 * All seeded accounts use the password "rare@123". Captain: admin@rare.com, players: <name>@rare.com.
 */
import { connectDb, disconnectDb } from './lib/db.js';
import { seedTeamRare } from './seed-data.js';

async function main() {
  await connectDb();
  await seedTeamRare({ wipe: true });
  await disconnectDb();
}

main().catch(async (e) => {
  console.error(e);
  await disconnectDb();
  process.exit(1);
});

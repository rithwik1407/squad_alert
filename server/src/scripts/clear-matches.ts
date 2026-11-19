/** CLI: npm run clear-matches. Deletes every match (and its squads, logs, check-ins, stats, alert jobs). Teams and players stay. */
import { connectDb, disconnectDb } from '../lib/db.js';
import { deleteMatchesFor } from './clearMatches.js';

async function main() {
  await connectDb();
  const n = await deleteMatchesFor({});
  console.log(`Deleted ${n} match${n === 1 ? '' : 'es'} (teams and players kept).`);
  await disconnectDb();
}

main().catch(async (e) => {
  console.error(e);
  await disconnectDb();
  process.exit(1);
});

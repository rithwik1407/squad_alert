import dns from 'node:dns';
import mongoose from 'mongoose';
import { config } from '../config.js';

/**
 * Atlas "mongodb+srv://" URIs need a DNS SRV lookup, which some ISP/router resolvers refuse
 * (error: querySrv ECONNREFUSED _mongodb._tcp...). Point Node's resolver at public DNS first.
 * MONGO_DNS_SERVERS: comma-separated servers (default 8.8.8.8,1.1.1.1), or "off" to use the system DNS.
 */
export function applyMongoDnsWorkaround(uri: string) {
  if (!uri.startsWith('mongodb+srv://')) return;
  const setting = (process.env.MONGO_DNS_SERVERS ?? '8.8.8.8,1.1.1.1').trim();
  if (!setting || ['off', 'false', '0', 'system'].includes(setting.toLowerCase())) return;
  const servers = setting.split(',').map((s) => s.trim()).filter(Boolean);
  try {
    dns.setServers(servers);
  } catch (e) {
    console.warn(`[db] ignoring invalid MONGO_DNS_SERVERS "${setting}": ${(e as Error).message}`);
  }
}

export async function connectDb(uri = config.mongoUri) {
  applyMongoDnsWorkaround(uri);
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15_000 });
  return mongoose.connection;
}

export async function disconnectDb() {
  await mongoose.disconnect();
}

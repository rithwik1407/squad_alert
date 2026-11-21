import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import bcrypt from 'bcryptjs';

/**
 * Signup approval flow against an in-memory stand-in for the User and Team models
 * (no MongoDB needed): register → pending → can't sign in → admin approves → joins the team.
 */
type U = Record<string, any> & { _id: string };
const db = { users: [] as U[], team: null as null | { _id: string; captainId: string; memberIds: string[]; name: string; joinCode: string } };
let seq = 0;
const id = () => (++seq).toString(16).padStart(24, '0');
const matches = (u: U, q: Record<string, unknown>) => Object.entries(q).every(([k, v]) => String(u[k]) === String(v));

function doc(u: U) {
  return Object.assign(Object.create({
    set(this: U, patch: Record<string, unknown>) { Object.assign(this, patch); },
    async save(this: U) { Object.assign(db.users.find((x) => x._id === this._id)!, this); },
    toJSON(this: U) { const { passwordHash, ...rest } = this; return { ...rest, isAdmin: this.email === 'admin@rare.com' }; },
  }), u);
}
const query = (val: unknown) => ({ lean: async () => val, select: async () => val, sort: () => ({ lean: async () => val }), then: (r: (v: unknown) => void) => r(val) });

vi.mock('../src/models/index.js', () => {
  const User = {
    findOne: (q: Record<string, unknown>) => { const u = db.users.find((x) => matches(x, q)); return query(u ? doc({ ...u }) : null); },
    findById: (i: string) => { const u = db.users.find((x) => x._id === String(i)); return query(u ? doc({ ...u }) : null); },
    find: (q: Record<string, any>) => query(db.users.filter((u) => (q._id?.$in ? q._id.$in.map(String).includes(u._id) : matches(u, q)))),
    exists: async (q: Record<string, unknown>) => db.users.some((u) => matches(u, q)),
    create: async (u: Record<string, unknown>) => { const d = { _id: id(), status: 'active', ...u } as U; db.users.push(d); return doc({ ...d }); },
    deleteOne: async (q: Record<string, unknown>) => { const n = db.users.length; db.users = db.users.filter((u) => !matches(u, q)); return { deletedCount: n - db.users.length }; },
  };
  const Team = {
    findById: (i: string) => query(db.team && db.team._id === String(i) ? db.team : null),
    findOneAndUpdate: async (q: { _id: string }, upd: { $addToSet: { memberIds: string } }) => {
      if (!db.team || db.team._id !== String(q._id) || db.team.memberIds.length >= 15) return null;
      db.team.memberIds.push(String(upd.$addToSet.memberIds));
      return db.team;
    },
  };
  return {
    User, Team, TEAM_SIZE: 15, MAPS: ['Erangel'], ALL_MAPS: ['Erangel'],
    isAdmin: (u: { email?: string } | null | undefined) => u?.email === 'admin@rare.com',
  };
});

let server: Server;
let base = '';
beforeAll(async () => {
  const express = (await import('express')).default;
  const cookieParser = (await import('cookie-parser')).default;
  const { authRouter } = await import('../src/routes/auth.js');
  const { teamRouter } = await import('../src/routes/team.js');
  const { errorHandler } = await import('../src/middleware/handlers.js');
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRouter);
  app.use('/api/team', teamRouter);
  app.use(errorHandler);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(() => server?.close());

beforeEach(async () => {
  const passwordHash = await bcrypt.hash('rare@123', 4);
  const adminId = id();
  db.team = { _id: id(), captainId: adminId, memberIds: [], name: 'TEAM RARE', joinCode: 'RARE25' };
  db.users = [
    { _id: adminId, email: 'admin@rare.com', name: 'Admin', ign: 'RARE丨CAPTAIN', role: 'captain', status: 'active', teamId: db.team._id, passwordHash },
  ];
});

async function call(path: string, body?: unknown, cookie?: string) {
  const res = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => ({})), cookie: res.headers.get('set-cookie')?.split(';')[0] };
}
const signup = { name: 'New Guy', email: 'new@x.com', password: 'secret123', ign: 'RARE丨NEW', bgmiId: '5512345678', phone: '9876543210', mode: 'player' };

describe('signup approval', () => {
  it('registers as pending, without a session cookie', async () => {
    const r = await call('/auth/register', signup);
    expect(r.status).toBe(202);
    expect(r.cookie).toBeUndefined();
    expect(db.users.find((u) => u.email === 'new@x.com')).toMatchObject({ status: 'pending', teamId: null, whatsappNumber: '919876543210', role: 'player' });
  });

  it('blocks sign-in while pending and blocks registering the admin email', async () => {
    await call('/auth/register', signup);
    expect((await call('/auth/login', { email: 'new@x.com', password: 'secret123' })).status).toBe(403);
    expect((await call('/auth/register', { ...signup, email: 'admin@rare.com' })).status).toBe(409);
    expect((await call('/auth/register', signup)).status).toBe(409);
  });

  it('only the admin can see and approve requests; approval adds them to the team', async () => {
    await call('/auth/register', { ...signup, mode: 'captain' });
    const pendingId = db.users.find((u) => u.email === 'new@x.com')!._id;

    // A normal team member can't approve.
    const member = await call('/auth/register', { ...signup, email: 'p2@x.com' });
    expect(member.status).toBe(202);
    db.users.find((u) => u.email === 'p2@x.com')!.status = 'active';
    const p2 = await call('/auth/login', { email: 'p2@x.com', password: 'secret123' });
    expect((await call('/team/requests', undefined, p2.cookie)).status).toBe(403);
    expect((await call(`/team/requests/${pendingId}/approve`, {}, p2.cookie)).status).toBe(403);

    const admin = await call('/auth/login', { email: 'admin@rare.com', password: 'rare@123' });
    expect(admin.status).toBe(200);
    const list = await call('/team/requests', undefined, admin.cookie);
    expect(list.data.requests.map((r: { email: string }) => r.email)).toContain('new@x.com');

    const ok = await call(`/team/requests/${pendingId}/approve`, {}, admin.cookie);
    expect(ok.status).toBe(200);
    expect(db.team!.memberIds).toContain(pendingId);
    expect(db.users.find((u) => u._id === pendingId)).toMatchObject({ status: 'active', teamId: db.team!._id, role: 'captain' });

    const login = await call('/auth/login', { email: 'new@x.com', password: 'secret123' });
    expect(login.status).toBe(200);
  });

  it('reject deletes the pending account', async () => {
    await call('/auth/register', signup);
    const pendingId = db.users.find((u) => u.email === 'new@x.com')!._id;
    const admin = await call('/auth/login', { email: 'admin@rare.com', password: 'rare@123' });
    expect((await call(`/team/requests/${pendingId}/reject`, {}, admin.cookie)).status).toBe(200);
    expect(db.users.some((u) => u.email === 'new@x.com')).toBe(false);
  });

  it('the old join-code route is gone', async () => {
    const admin = await call('/auth/login', { email: 'admin@rare.com', password: 'rare@123' });
    expect((await call('/team/join', { code: 'RARE25' }, admin.cookie)).status).toBe(404);
  });
});

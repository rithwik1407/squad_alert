import { Types } from 'mongoose';
import { DeliveryClaim, Match, NotificationLog, Squad, Stats, Team, User } from '../models/index.js';
import type { DispatchRepo } from './dispatch.js';
import type { Recipient } from '../notifications/types.js';
import { saveToInbox } from '../lib/inbox.js';

const oid = (id: string) => new Types.ObjectId(id);

export const mongoDispatchRepo: DispatchRepo = {
  async getMatch(matchId) {
    const m = await Match.findById(matchId).lean();
    if (!m) return null;
    return {
      id: String(m._id), teamId: String(m.teamId), title: m.title, map: m.map, startAt: m.startAt,
      notifyOffsetMin: m.notifyOffsetMin, roomId: m.roomId ?? '', roomPassword: m.roomPassword ?? '', slot: m.slot ?? '',
      status: m.status, notifiedAt: m.notifiedAt ?? null,
    };
  },
  async getSquad(matchId) {
    const s = await Squad.findOne({ matchId: oid(matchId) }).lean();
    return s ? { selectedIds: s.selectedIds.map(String), confirmed: s.confirmed } : null;
  },
  async getCaptainId(teamId) {
    const t = await Team.findById(teamId).lean();
    return t ? String(t.captainId) : null;
  },
  async getRecipients(ids) {
    if (!ids.length) return [];
    const users = await User.find({ _id: { $in: ids.map(oid) } }).lean();
    return users.map<Recipient>((u) => ({
      id: String(u._id), name: u.name, ign: u.ign, fcmTokens: u.fcmTokens ?? [],
      telegramChatId: u.telegramChatId ?? null, whatsappNumber: u.whatsappNumber ?? null,
      notifyPrefs: {
        push: u.notifyPrefs?.push ?? true,
        telegram: u.notifyPrefs?.telegram ?? true,
        whatsapp: u.notifyPrefs?.whatsapp ?? true,
      },
    }));
  },
  async hasSent(matchId, userId, kind) {
    return Boolean(await NotificationLog.exists({ matchId: oid(matchId), userId: oid(userId), kind, status: 'sent' }));
  },
  async claim(matchId, userId, kind) {
    const key = { matchId: oid(matchId), userId: oid(userId), kind };
    const expiresAt = new Date(Date.now() + 24 * 3600_000);
    try {
      await DeliveryClaim.create({ ...key, expiresAt });
      return true;
    } catch (e) {
      if ((e as { code?: number }).code !== 11000) throw e;
      // A claim left behind by a crashed worker becomes reclaimable after 2 minutes.
      const stale = await DeliveryClaim.findOneAndUpdate(
        { ...key, expiresAt: { $lt: new Date(Date.now() + 24 * 3600_000 - 120_000) } },
        { $set: { expiresAt } },
      );
      return Boolean(stale) && !(await this.hasSent(matchId, userId, kind));
    }
  },
  async release(matchId, userId, kind) {
    await DeliveryClaim.deleteOne({ matchId: oid(matchId), userId: oid(userId), kind });
  },
  async writeLog(entry) {
    if (entry.repeatable && entry.status === 'sent') {
      const { repeatable: _r, ...row } = entry;
      const key = { matchId: oid(entry.matchId), userId: oid(entry.userId), kind: entry.kind, status: 'sent' };
      await NotificationLog.updateOne(key, { $set: { ...row, ...key } }, { upsert: true });
      return true;
    }
    try {
      await NotificationLog.create({ ...entry, matchId: oid(entry.matchId), userId: oid(entry.userId) });
      return true;
    } catch (e) {
      if ((e as { code?: number }).code === 11000) return false; // another run already sent it
      throw e;
    }
  },
  async markNotified(matchId, at) {
    await Match.updateOne({ _id: oid(matchId), notifiedAt: null }, { $set: { notifiedAt: at, status: 'notified' } });
  },
  async markCaptainAlerted(matchId, at) {
    await Match.updateOne({ _id: oid(matchId) }, { $set: { captainAlertedAt: at } });
  },
  async getResults(matchId) {
    const rows = await Stats.find({ matchId: oid(matchId) }).lean();
    return rows.map((s) => ({
      userId: String(s.userId), kills: s.kills ?? 0, damage: s.damage ?? 0, assists: s.assists ?? 0,
      survivalMin: s.survivalMin ?? 0, mvp: Boolean(s.mvp),
    }));
  },
  async clearTelegramChat(userId) {
    await User.updateOne({ _id: oid(userId) }, { $set: { telegramChatId: null } });
  },
  async saveInbox(userId, matchId, kind, payload) {
    await saveToInbox([userId], { kind, title: payload.title, body: payload.body, url: payload.url, matchId });
  },
  async removeFcmTokens(userId, tokens) {
    await User.updateOne({ _id: oid(userId) }, { $pull: { fcmTokens: { $in: tokens } } });
  },
};

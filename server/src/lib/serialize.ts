import type { Types } from 'mongoose';

type Id = Types.ObjectId | string;
const s = (id: Id | null | undefined) => (id ? String(id) : null);

export interface LogSummary { sent: number; failed: number; pending: number }

export function publicUser(u: {
  _id: Id; name: string; ign: string; bgmiId?: string | null; role: string; avatar?: string | null;
  fcmTokens?: string[]; telegramChatId?: string | null; whatsappNumber?: string | null;
  notifyPrefs?: { whatsapp?: boolean | null } | null;
}) {
  return {
    id: String(u._id),
    name: u.name,
    ign: u.ign,
    bgmiId: u.bgmiId ?? '',
    role: u.role,
    avatar: u.avatar ?? '',
    pushEnabled: (u.fcmTokens?.length ?? 0) > 0,
    telegramLinked: Boolean(u.telegramChatId),
    whatsappLinked: Boolean(u.whatsappNumber) && u.notifyPrefs?.whatsapp !== false,
  };
}

export function serializeMatch(
  m: {
    _id: Id; teamId: Id; title: string; type: string; map: string; drop?: string | null; startAt: Date;
    notifyOffsetMin: number; roomId?: string | null; roomPassword?: string | null; status: string;
    notifiedAt?: Date | null; captainAlertedAt?: Date | null; tournamentName?: string | null; placement?: number | null;
  },
  squad?: { selectedIds: Id[]; benchedId?: Id | null; confirmed: boolean; updatedAt?: Date } | null,
  logs?: LogSummary,
) {
  return {
    id: String(m._id),
    teamId: String(m.teamId),
    title: m.title,
    type: m.type,
    map: m.map,
    drop: m.drop ?? '',
    startAt: m.startAt.toISOString(),
    notifyAt: new Date(m.startAt.getTime() - m.notifyOffsetMin * 60_000).toISOString(),
    notifyOffsetMin: m.notifyOffsetMin,
    roomId: m.roomId ?? '',
    roomPassword: m.roomPassword ?? '',
    status: m.status,
    notifiedAt: m.notifiedAt?.toISOString() ?? null,
    captainAlertedAt: m.captainAlertedAt?.toISOString() ?? null,
    locked: Boolean(m.notifiedAt),
    tournamentName: m.tournamentName ?? '',
    placement: m.placement ?? null,
    squad: squad
      ? {
          selectedIds: squad.selectedIds.map(String),
          benchedId: s(squad.benchedId),
          confirmed: squad.confirmed,
          updatedAt: squad.updatedAt?.toISOString() ?? null,
        }
      : null,
    notifications: logs ?? null,
  };
}

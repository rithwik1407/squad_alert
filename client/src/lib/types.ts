export type Role = 'captain' | 'player';
export const MAPS = ['Erangel', 'Miramar', 'Sanhok', 'Vikendi', 'Livik'] as const;
export type MapName = (typeof MAPS)[number];
export type MatchStatus = 'scheduled' | 'notified' | 'live' | 'done' | 'cancelled';

export interface User {
  _id: string;
  name: string;
  email: string;
  ign: string;
  bgmiId: string;
  role: Role;
  avatar: string;
  teamId: string | null;
  whatsappNumber?: string | null;
  telegramLinked: boolean;
  pushEnabled: boolean;
  notifyPrefs: { push: boolean; telegram: boolean; whatsapp: boolean };
}

export interface Member {
  id: string;
  name: string;
  ign: string;
  bgmiId: string;
  role: Role;
  avatar: string;
  pushEnabled: boolean;
  telegramLinked: boolean;
}

export interface Team {
  id: string;
  name: string;
  tag: string;
  logo: string;
  joinCode: string;
  drops: Partial<Record<MapName, string>>;
  captain: Member | null;
  members: Member[];
}

export interface Match {
  id: string;
  teamId: string;
  title: string;
  type: 'scrim' | 'tournament';
  map: MapName;
  drop: string;
  startAt: string;
  notifyAt: string;
  notifyOffsetMin: number;
  roomId: string;
  roomPassword: string;
  status: MatchStatus;
  notifiedAt: string | null;
  captainAlertedAt: string | null;
  locked: boolean;
  tournamentName: string;
  placement: number | null;
  squad: { selectedIds: string[]; benchedId: string | null; confirmed: boolean; updatedAt: string | null } | null;
  notifications: { sent: number; failed: number; pending: number } | null;
}

export interface NotificationLog {
  id: string;
  matchId: string;
  match?: { title: string; map: string; startAt: string };
  userId: string;
  user?: { name: string; ign: string };
  kind: 'squad' | 'captain_alert';
  channel: 'fcm' | 'telegram' | 'whatsapp' | 'none';
  status: 'sent' | 'failed' | 'skipped';
  trigger: string;
  title: string;
  body: string;
  sentAt: string;
  error: string | null;
}

export interface StatsRow {
  matchId: string;
  title: string;
  map: MapName;
  type: string;
  startAt: string;
  selected: boolean;
  joined: boolean | null;
  kills: number;
  damage: number;
  mvp: boolean;
}

export interface MyStats {
  rows: StatsRow[];
  totals: { matches: number; kills: number; damage: number; mvps: number; attendanceRate: number | null };
}

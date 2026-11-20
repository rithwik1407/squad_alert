export type Role = 'captain' | 'player';
export const MAPS = ['Erangel', 'Miramar', 'Sanhok', 'Vikendi', 'Livik'] as const;
export type MapName = (typeof MAPS)[number];
export const MAP_TBD = 'TBD' as const;
/** A match's map: one of the maps, or 'TBD' (not decided yet). */
export type MatchMap = MapName | typeof MAP_TBD;
export const mapLabel = (m: MatchMap) => (m === MAP_TBD ? 'Map TBD' : m);
export type Availability = 'available' | 'maybe' | 'unavailable';
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
  /** True only for the admin account (admin@rare.com), who approves new signups. */
  isAdmin?: boolean;
  whatsappNumber?: string | null;
  telegramLinked: boolean;
  whatsappLinked?: boolean;
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
  whatsappLinked?: boolean;
  /** Only sent to the captain. */
  email?: string;
  whatsappNumber?: string;
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
  map: MatchMap;
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
  /** userId → check-in status */
  availability: Record<string, Availability>;
  availabilityNotes: Record<string, string>;
  /** userIds who tapped "I'm joining" */
  joining: string[];
  myAvailability: Availability | null;
  myJoining: boolean;
  /** True when the signed-in user is in this match's confirmed squad. Room details are only sent to them. */
  inSquad: boolean;
  batchId?: string | null;
}

export interface CheckinMatch {
  id: string;
  title: string;
  type: 'scrim' | 'tournament';
  map: MatchMap;
  drop: string;
  startAt: string;
  status: MatchStatus;
  myAvailability: Availability | null;
  myNote: string;
  squadPicked: boolean;
  selected: boolean;
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

export interface MatchStat {
  userId: string;
  kills: number;
  damage: number;
  survivalMin: number;
  assists: number;
  mvp: boolean;
  mvpScore: number;
}

export interface MatchReport {
  /** false until the match start time; attendance and stats stay hidden until then. */
  open: boolean;
  attendance: { userId: string; joined: boolean }[];
  stats: MatchStat[];
}

/** A row read from a BGMI results screenshot, matched to a team member when the IGN fits. */
export interface ScorecardRow {
  name: string;
  finishes: number;
  assists: number;
  damage: number;
  survivedMin: number;
  userId: string | null;
}

export interface StatsRow {
  matchId: string;
  title: string;
  map: MatchMap;
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

/** Someone who registered and is waiting for the admin to approve them. */
export interface JoinRequest {
  id: string;
  name: string;
  email: string;
  ign: string;
  bgmiId: string;
  phone: string;
  role: Role;
  createdAt: string;
}

export type ChatMode = 'always' | 'hours' | 'closed';

export interface ChatMessage {
  id: string;
  userId: string | null;
  ign: string;
  avatar: string;
  isAdmin: boolean;
  role: Role;
  text: string;
  system: boolean;
  mine: boolean;
  createdAt: string;
}

export interface ChatState {
  open: boolean;
  mode: ChatMode;
  /** "HH:MM" in the team's time zone. */
  openFrom: string;
  openTo: string;
  timeZone: string;
  isAdmin: boolean;
  canPost: boolean;
  /** Set when the admin muted me. */
  mutedUntil: string | null;
}

export interface ChatMute { userId: string; until: string }

export type Role = 'captain' | 'player';
/** Maps offered when scheduling. */
export const MAPS = ['Erangel', 'Miramar', 'Rondo'] as const;
/** No longer offered, but older matches may still show them. */
export const RETIRED_MAPS = ['Sanhok', 'Vikendi', 'Livik'] as const;
export type MapName = (typeof MAPS)[number] | (typeof RETIRED_MAPS)[number];
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
  /** In-game role (IGL, Assaulter...), used by the Squad AI for role balance. Empty until picked. */
  gameRole?: string;
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
  /** Our slot number in the room. */
  slot: string;
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
  kind: 'squad' | 'captain_alert' | 'selected' | 'results' | 'room';
  /** Other channels that also delivered this alert. */
  alsoVia?: ('fcm' | 'telegram' | 'whatsapp')[];
  channel: 'fcm' | 'telegram' | 'whatsapp' | 'none';
  status: 'sent' | 'failed' | 'skipped';
  trigger: string;
  title: string;
  body: string;
  sentAt: string;
  error: string | null;
}

export type InboxKind = 'squad' | 'captain_alert' | 'selected' | 'results' | 'room' | 'invite' | 'ai_message' | 'challenge';

/** Your own copy of a notification SquadSync sent you (kept 30 days, or until you delete it). */
export interface InboxItem {
  id: string;
  kind: InboxKind;
  title: string;
  body: string;
  url: string;
  matchId: string | null;
  read: boolean;
  createdAt: string;
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
  /** Outside players from the results screenshot: on this match only, never in stats or the team. */
  guests: GuestStat[];
  /** Squad finishing position (from the screenshot or typed in). */
  placement: number | null;
  /** When a results screenshot was saved; null when there is none. */
  screenshotAt: string | null;
}

/** A player on the results who isn't on our team. */
export interface GuestStat { name: string; kills: number; damage: number; survivalMin: number; assists: number }

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
  /** Kept in the posted results (picked but left out = not played). */
  played?: boolean;
  joined: boolean | null;
  kills: number;
  damage: number;
  mvp: boolean;
}

export interface TeamStatsPlayer {
  id: string;
  name: string;
  ign: string;
  avatar: string;
}

export interface TeamStatsMatch {
  matchId: string;
  title: string;
  map: MatchMap;
  type: string;
  startAt: string;
  placement: number | null;
  stats: MatchStat[];
}

export interface TeamStats {
  players: TeamStatsPlayer[];
  matches: TeamStatsMatch[];
}

export interface MyStats {
  rows: StatsRow[];
  totals: { matches: number; kills: number; damage: number; mvps: number; attendanceRate: number | null; attended?: number; attendanceOf?: number };
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

/** What the server read from a scrim / tournament schedule screenshot. Fills the create-match forms. */
export interface ParsedSchedule {
  name: string;
  type: 'scrim' | 'tournament';
  /** IST date, YYYY-MM-DD. */
  date: string;
  /** The date as written in the image when it had to be changed (e.g. an old year), else ''. */
  dateNote: string;
  /** time is the IDP time (24h HH:MM): the match is scheduled at it. startTime is the start shown, for reference. */
  matches: { number: number; time: string; startTime: string; map: MatchMap }[];
}

/** Organizer contact card for one scrim / tournament series. */
export interface ScrimSeries {
  id: string;
  name: string;
  /** Name with case, spaces and punctuation removed. Matches link to it through tournamentName. */
  key: string;
  organizer: string;
  discordInvite: string;
  discordChannel: string;
  contact: string;
  notes: string;
  updatedAt: string | null;
  matchCount: number;
}

export interface ScrimSeriesList {
  canEdit: boolean;
  series: ScrimSeries[];
  /** Series names used on matches that have no contact card yet. */
  unsaved: { name: string; matchCount: number }[];
}

export type ScrimSeriesInput = Pick<ScrimSeries, 'name' | 'organizer' | 'discordInvite' | 'discordChannel' | 'contact' | 'notes'>;

/** One match on the calendar, with its points (placement points + 1 per finish). */
export interface CalendarMatch {
  id: string;
  title: string;
  /** Scrim / tournament name the match is grouped under (the match title when no name was given). */
  series: string;
  seriesKey: string;
  type: 'scrim' | 'tournament';
  map: MatchMap;
  startAt: string;
  status: MatchStatus;
  placement: number | null;
  /** Team finishes from the saved scorecard; null when none was saved. */
  kills: number | null;
  placementPts: number;
  killPts: number;
  total: number;
  hasResult: boolean;
  /** Finished. Only completed matches count toward points, totals and player numbers. */
  completed: boolean;
  stats: { userId: string; kills: number; damage: number; assists: number; mvp: boolean }[];
  /** Teammates who played (left out of the posted results = not played). */
  playedIds?: string[];
  /** Outside players on the results (not on the team). */
  guestCount?: number;
}

export interface CalendarTotals {
  /** Completed matches. */
  matches: number;
  /** Not finished yet (upcoming or still running). */
  upcoming: number;
  withResult: number;
  kills: number;
  placementPts: number;
  killPts: number;
  total: number;
  wins: number;
  bestPlacement: number | null;
}

export interface CalendarDay {
  /** YYYY-MM-DD in the team time zone. */
  day: string;
  matches: CalendarMatch[];
  totals: CalendarTotals;
  players: { userId: string; matches: number; kills: number; damage: number; assists: number; mvps: number }[];
}

export interface CalendarMonth {
  /** YYYY-MM */
  month: string;
  today: string;
  timeZone: string;
  pointsSystem: { placement: Record<string, number>; perKill: number };
  players: TeamStatsPlayer[];
  days: CalendarDay[];
}

export interface InvitePerson { id: string; name: string; ign: string; avatar: string }

/** "Can we play a classic match?" sent to picked teammates. */
export interface ClassicInvite {
  id: string;
  from: InvitePerson;
  message: string;
  /** The challenge picked for this match, if any. */
  challenge: (Challenge & { daily: boolean; runId: string }) | null;
  createdAt: string | null;
  sentByMe: boolean;
  /** When the invite runs out and disappears (7 minutes after it was sent). */
  expiresAt: string | null;
  /** My answer when I was invited (undefined when I'm the sender). */
  myResponse?: 'in' | 'out' | null;
  recipients: { user: InvitePerson; response: 'in' | 'out' | null; respondedAt: string | null; delivered: string[] }[];
}

export type ChallengeMode = 'Classic' | 'WOW' | 'TDM';
export type BadgeTier = 'bronze' | 'silver' | 'gold';

/** One squad challenge from the pool. Finishing it earns its badge. */
export interface Challenge {
  key: string;
  mode: ChallengeMode;
  title: string;
  text: string;
  matches: number;
  tier: BadgeTier;
  badge: { name: string; emoji: string };
}

export type ChallengeStatus = 'waiting' | 'asking' | 'begun' | 'completed' | 'failed' | 'not_played' | 'cancelled' | 'expired';

/** A challenge picked on a classic invite, and how it went. */
export interface ChallengeRun {
  id: string;
  challenge: Challenge;
  daily: boolean;
  status: ChallengeStatus;
  from: InvitePerson | null;
  players: InvitePerson[];
  askAt: string;
  createdAt: string | null;
  completedAt: string | null;
  begun: { by: InvitePerson | null; at: string; yes: boolean } | null;
  done: { by: InvitePerson | null; at: string; yes: boolean } | null;
  /** I'm one of the players it was for. */
  mine: boolean;
  /** The question waiting on me right now, if any. */
  ask: 'begun' | 'done' | null;
}

export interface BadgeCount {
  key: string;
  name: string;
  emoji: string;
  tier: BadgeTier;
  mode: ChallengeMode;
  count: number;
  daily: number;
  lastAt: string | null;
}

export interface BadgeBoard {
  team: { total: number; badges: BadgeCount[] };
  players: { user: InvitePerson; total: number; badges: BadgeCount[] }[];
}

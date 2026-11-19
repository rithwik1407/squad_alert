export const ROLES = ['captain', 'player'] as const;
export type Role = (typeof ROLES)[number];

export const MAPS = ['Erangel', 'Miramar', 'Sanhok', 'Vikendi', 'Livik'] as const;
export type MapName = (typeof MAPS)[number];

export const MATCH_TYPES = ['scrim', 'tournament'] as const;
export type MatchType = (typeof MATCH_TYPES)[number];

export const MATCH_STATUS = ['scheduled', 'notified', 'live', 'done', 'cancelled'] as const;
export type MatchStatus = (typeof MATCH_STATUS)[number];

export const CHANNELS = ['fcm', 'telegram', 'whatsapp', 'none'] as const;
export type Channel = (typeof CHANNELS)[number];

export const LOG_STATUS = ['sent', 'failed', 'skipped'] as const;
export type LogStatus = (typeof LOG_STATUS)[number];

export const LOG_KINDS = ['squad', 'captain_alert'] as const;
export type LogKind = (typeof LOG_KINDS)[number];

export const SQUAD_SIZE = 4;
export const TEAM_SIZE = 5;

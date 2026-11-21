export const ROLES = ['captain', 'player'] as const;
export type Role = (typeof ROLES)[number];

/** Maps the team can pick for new matches. */
export const MAPS = ['Erangel', 'Miramar', 'Rondo'] as const;
export type MapName = (typeof MAPS)[number];
/** No longer offered, but older matches may still be on them, so the schema keeps accepting them. */
export const RETIRED_MAPS = ['Sanhok', 'Vikendi', 'Livik'] as const;
/** A match can be scheduled before the map is known. */
export const MAP_TBD = 'TBD' as const;
/** Maps a new or edited match can be set to. */
export const PICKABLE_MAPS = [...MAPS, MAP_TBD] as const;
/** Every value a stored match's map can hold (DB enum). */
export const MATCH_MAPS = [...MAPS, ...RETIRED_MAPS, MAP_TBD] as const;
export type MatchMap = (typeof MATCH_MAPS)[number];

export const AVAILABILITY = ['available', 'maybe', 'unavailable'] as const;
export type AvailabilityStatus = (typeof AVAILABILITY)[number];

export const MATCH_TYPES = ['scrim', 'tournament'] as const;
export type MatchType = (typeof MATCH_TYPES)[number];

export const MATCH_STATUS = ['scheduled', 'notified', 'live', 'done', 'cancelled'] as const;
export type MatchStatus = (typeof MATCH_STATUS)[number];

export const CHANNELS = ['fcm', 'telegram', 'whatsapp', 'none'] as const;
export type Channel = (typeof CHANNELS)[number];

export const LOG_STATUS = ['sent', 'failed', 'skipped'] as const;
export type LogStatus = (typeof LOG_STATUS)[number];

export const LOG_KINDS = ['squad', 'captain_alert', 'selected', 'results'] as const;
export type LogKind = (typeof LOG_KINDS)[number];

export const SQUAD_SIZE = 4;
/** Max players on a team (besides the main captain). Room for subs beyond the 4 picked per match. */
export const TEAM_SIZE = 15;

export const USER_STATUS = ['active', 'pending'] as const;
export type UserStatus = (typeof USER_STATUS)[number];

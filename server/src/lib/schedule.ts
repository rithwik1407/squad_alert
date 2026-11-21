import { HttpError } from './errors.js';
import { extractJson, readImage, type VisionTask } from './scorecard.js';
import { MAPS, MAP_TBD } from '../models/constants.js';

/** What a scrim / tournament schedule screenshot says, ready to fill the create-match form. */
export interface ParsedSchedule {
  /** Organiser or event name, e.g. "EG Daily Scrims", "TortugaScrims · Group 3254". */
  name: string;
  type: 'scrim' | 'tournament';
  /** IST date, YYYY-MM-DD. Today when the image shows none. */
  date: string;
  /** The date as written in the image when it had to be changed (e.g. an old year), else ''. */
  dateNote: string;
  matches: {
    /** 1, 2, 3… as numbered in the image. */
    number: number;
    /** IDP time, 24h "HH:MM". This is the time the match is scheduled at in the app. */
    time: string;
    /** Start time as shown, 24h "HH:MM", or '' if not shown. For display only. */
    startTime: string;
    map: (typeof MAPS)[number] | typeof MAP_TBD;
  }[];
}

const PROMPT = `This image should be a BGMI (Battlegrounds Mobile India) scrim or tournament schedule: for example a Discord
bot message "SCHEDULE FOR GROUP 1234" listing "Match 1  IDP: 09:54PM | Start: 10:00PM", or a banner such as
"EG DAILY SCRIMS" with cards M1, M2… each showing a map, an IDP time and a start time.

Read it and return:
- isSchedule: true only if it really lists match timings for a scrim or tournament. For anything else (a results table,
  a lobby, chat without timings, a photo, another game) set it to false and return an empty matches list.
- eventName: the scrim or tournament name as shown: the banner title (e.g. "EG Daily Scrims") or, for a Discord message,
  the name of the bot / organiser that posted it (e.g. "TortugaScrims", "ARISE SCRIMS (AQ)"). Leave out emoji.
- group: the group / lobby number if shown (e.g. "3254"), else "".
- isTournament: true only if the image calls it a tournament, cup, league, qualifier or similar; daily scrims are false.
- date: the match date exactly as written (e.g. "20th NOVEMBER", "2022-11-20"), or "" if none is shown.
- matches: one entry per match, in order:
  - number: the match number (M1 -> 1, "Match 2" -> 2)
  - idp: the IDP time (ID & password time) in 24-hour "HH:MM", e.g. "09:54PM" -> "21:54", "9:20 PM" -> "21:20"
  - start: the start time in 24-hour "HH:MM", or "" if not shown
  - map: the map name if shown (Erangel, Miramar, Rondo, Sanhok, Vikendi, Livik…), else "".
Ignore lobby time and registration time: only the per-match IDP and start times matter.`;

const JSON_HINT = `
Reply with JSON only, no other text, in exactly this shape:
{"isSchedule": true, "eventName": "EG Daily Scrims", "group": "", "isTournament": false, "date": "", "matches": [{"number": 1, "idp": "21:20", "start": "21:30", "map": "Rondo"}]}`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['isSchedule', 'eventName', 'group', 'isTournament', 'date', 'matches'],
  properties: {
    isSchedule: { type: 'boolean' },
    eventName: { type: 'string' },
    group: { type: 'string' },
    isTournament: { type: 'boolean' },
    date: { type: 'string' },
    matches: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['number', 'idp', 'start', 'map'],
        properties: { number: { type: 'integer' }, idp: { type: 'string' }, start: { type: 'string' }, map: { type: 'string' } },
      },
    },
  },
};

const GEMINI_SCHEMA = {
  type: 'OBJECT',
  required: ['isSchedule', 'eventName', 'group', 'isTournament', 'date', 'matches'],
  properties: {
    isSchedule: { type: 'BOOLEAN' },
    eventName: { type: 'STRING' },
    group: { type: 'STRING' },
    isTournament: { type: 'BOOLEAN' },
    date: { type: 'STRING' },
    matches: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        required: ['number', 'idp', 'start', 'map'],
        properties: { number: { type: 'INTEGER' }, idp: { type: 'STRING' }, start: { type: 'STRING' }, map: { type: 'STRING' } },
      },
    },
  },
};

/** The image isn't a schedule. The app shows a "schedule screenshot only" message for this. */
export class NotScheduleError extends HttpError {
  name = 'NotScheduleError';
  constructor() { super(422, "This image doesn't look like a match schedule. Upload the scrim or tournament schedule that shows each match's IDP time."); }
}

const MANUAL = 'fill the matches in by hand';

/** "09:54PM", "9:20 PM", "21:54", "10.40 pm" → "21:54". '' when it can't be read. */
export function to24h(raw: unknown): string {
  const m = /(\d{1,2})\s*[:.]\s*(\d{2})\s*([ap])?\.?\s*m?/i.exec(String(raw ?? '').trim());
  if (!m) return '';
  let h = Number(m[1]);
  const min = Number(m[2]);
  const ap = m[3]?.toLowerCase();
  if (min > 59 || h > 23) return '';
  if (ap === 'p' && h < 12) h += 12;
  if (ap === 'a' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = (n: number) => String(n).padStart(2, '0');

/** Today in IST as YYYY-MM-DD. */
export function todayIST(now = new Date()): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

/**
 * "20th NOVEMBER", "Nov 20", "2022-11-20", "20/11/2026", "20-11" → YYYY-MM-DD.
 * No year: this year, or next year if that date is long gone (a December schedule read in January).
 * A year that is clearly stale (organisers' bots sometimes print an old one) is moved to this year.
 */
export function parseScheduleDate(raw: string, now = new Date()): { date: string; note: string } {
  const today = todayIST(now);
  const s = raw.trim().toLowerCase();
  if (!s) return { date: today, note: '' };
  const year = Number(today.slice(0, 4));
  let y: number | null = null;
  let mo: number | null = null;
  let d: number | null = null;
  let m: RegExpExecArray | null;
  if ((m = /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = /(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2,4}))?/.exec(s))) {
    d = +m[1]; mo = +m[2];
    if (m[3]) y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
  } else {
    const mi = MONTHS.findIndex((x) => s.includes(x));
    const dm = /(\d{1,2})(?:st|nd|rd|th)?\b/.exec(s.replace(/\d{4}/, ''));
    const ym = /\b(\d{4})\b/.exec(s);
    if (mi >= 0 && dm) { mo = mi + 1; d = +dm[1]; if (ym) y = +ym[1]; }
  }
  if (!mo || !d || mo > 12 || d > 31) return { date: today, note: raw.trim() };
  const iso = (yy: number) => `${yy}-${pad(mo!)}-${pad(d!)}`;
  const daysAgo = (date: string) => (Date.parse(today) - Date.parse(date)) / 864e5;
  if (y === null) {
    y = year;
    if (daysAgo(iso(y)) > 180) y += 1;
    return { date: iso(y), note: '' };
  }
  if (y < year) return { date: iso(year), note: raw.trim() };
  return { date: iso(y), note: '' };
}

function toMap(raw: unknown): ParsedSchedule['matches'][number]['map'] {
  const s = String(raw ?? '').trim().toLowerCase();
  return MAPS.find((m) => s.startsWith(m.toLowerCase().slice(0, 4))) ?? MAP_TBD;
}

/** Turn a reader's answer into a schedule. Throws NotScheduleError when the image isn't one. */
export function toSchedule(text: string, now = new Date()): ParsedSchedule {
  const p = extractJson<{
    isSchedule?: boolean; eventName?: string; group?: string; isTournament?: boolean; date?: string;
    matches?: { number?: number; idp?: string; start?: string; map?: string }[];
  }>(text, `Could not read that screenshot. ${MANUAL[0].toUpperCase() + MANUAL.slice(1)} instead.`);
  const seen = new Set<string>();
  const matches = (p.matches ?? [])
    .map((m, i) => ({
      number: Number.isFinite(Number(m.number)) && Number(m.number) > 0 ? Math.round(Number(m.number)) : i + 1,
      // No IDP shown: fall back to the start time.
      time: to24h(m.idp) || to24h(m.start),
      startTime: to24h(m.start),
      map: toMap(m.map),
    }))
    .filter((m) => m.time && !seen.has(m.time) && seen.add(m.time))
    .slice(0, 12);
  if (p.isSchedule === false || !matches.length) throw new NotScheduleError();
  const event = String(p.eventName ?? '').replace(/\s+/g, ' ').trim();
  const group = String(p.group ?? '').replace(/^\s*group\s*/i, '').trim();
  const name = (group && !event.includes(group) ? `${event || 'Scrims'} · Group ${group}` : event || 'Scrims').slice(0, 50);
  const { date, note } = parseScheduleDate(String(p.date ?? ''), now);
  return { name, type: p.isTournament ? 'tournament' : 'scrim', date, dateNote: note, matches };
}

const TASK: VisionTask<ParsedSchedule> = {
  prompt: PROMPT,
  jsonHint: JSON_HINT,
  schema: SCHEMA,
  geminiSchema: GEMINI_SCHEMA,
  parse: (text) => toSchedule(text),
  isFinal: (e) => e instanceof NotScheduleError,
  manual: MANUAL,
};

/** Read a schedule screenshot (data URL) with the same free reader chain as the results screenshots. */
export function readSchedule(dataUrl: string): Promise<ParsedSchedule> {
  return readImage(dataUrl, TASK);
}

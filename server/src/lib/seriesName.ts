/**
 * Key used to match a match's scrim/tournament name with a saved organizer contact.
 * Case, spacing and punctuation are ignored, so "EG Daily Scrims", "eg daily-scrims" and
 * "EG  DAILY SCRIMS!" all point at the same contact card.
 */
export function seriesKey(name: string | null | undefined): string {
  return (name ?? '').normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/** Accepts "discord.gg/abc" or a full link and returns an https URL, or '' for blank. Throws on junk. */
export function normalizeLink(raw: string | null | undefined): string {
  const v = (raw ?? '').trim();
  if (!v) return '';
  const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    throw new Error('Not a valid link');
  }
  if (!['http:', 'https:'].includes(u.protocol) || !u.hostname.includes('.')) throw new Error('Not a valid link');
  return u.toString();
}

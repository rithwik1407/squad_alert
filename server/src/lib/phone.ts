/**
 * Normalise a phone number to WhatsApp's format: country code + number, digits only (e.g. 919876543210).
 * A bare 10-digit Indian mobile gets 91 prepended. Returns null if it doesn't look like a phone number.
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  let d = input.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 10 && /^[6-9]/.test(d)) d = `91${d}`;
  return d.length >= 11 && d.length <= 15 ? d : null;
}

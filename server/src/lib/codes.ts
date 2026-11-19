import { randomBytes } from 'node:crypto';

// No 0/O/1/I to keep codes easy to read out loud on voice chat.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function joinCode(len = 6) {
  const bytes = randomBytes(len);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

export function linkToken() {
  return randomBytes(16).toString('hex');
}

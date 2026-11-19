import { describe, expect, it } from 'vitest';
import { normalizePhone } from '../src/lib/phone.js';
import { templateParams } from '../src/notifications/whatsapp.js';

describe('normalizePhone', () => {
  it.each([
    ['9876543210', '919876543210'],
    ['+91 98765 43210', '919876543210'],
    ['098765 43210', '919876543210'],
    ['0091-98765-43210', '919876543210'],
    ['+44 7700 900123', '447700900123'],
  ])('%s → %s', (a, b) => expect(normalizePhone(a)).toBe(b));
  it('rejects junk', () => {
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizePhone('')).toBeNull();
  });
});

describe('WhatsApp template params', () => {
  it('splits the alert body into match, map, time, room', () => {
    expect(templateParams({ title: 'Match in 2 minutes!', body: 'Scrim 1 · Erangel · 9:00 PM. Join the lobby now. Room: 4471823 / Pass: rare21', url: '/', matchId: 'm', tag: 't' }))
      .toEqual(['Scrim 1', 'Erangel', '9:00 PM', 'Room: 4471823 / Pass: rare21']);
  });
});

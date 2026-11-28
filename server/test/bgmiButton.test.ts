import { describe, expect, it } from 'vitest';
import { copyableRoom } from '../src/notifications/telegram.js';

describe('Telegram room details', () => {
  it('makes room ID, password and slot tap-to-copy', () => {
    expect(copyableRoom('Erangel · 9:00 PM. Room ID: 4471823 / Pass: rare21 / Slot: 7. Join the lobby now.'))
      .toBe('Erangel · 9:00 PM. Room ID: <code>4471823</code> / Pass: <code>rare21</code> / Slot: <code>7</code>. Join the lobby now.');
    expect(copyableRoom('Join the lobby now. Room: 1234 / Pass: abc')).toBe('Join the lobby now. Room: <code>1234</code> / Pass: <code>abc</code>');
  });

  it('leaves placeholders alone', () => {
    expect(copyableRoom('Room: TBA')).toBe('Room: TBA');
    expect(copyableRoom('Room ID: 55 / Pass: -.')).toBe('Room ID: <code>55</code> / Pass: -.');
  });
});

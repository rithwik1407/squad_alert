import { describe, expect, it } from 'vitest';
import { normalizeAvatarUrl } from '../src/lib/avatar.js';
import { effectiveStatus } from '../src/lib/serialize.js';

describe('normalizeAvatarUrl', () => {
  it('turns Google Drive share links into direct image links', () => {
    const want = 'https://lh3.googleusercontent.com/d/1AbCdEfGhIjKlMnOp=s400';
    expect(normalizeAvatarUrl('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing')).toBe(want);
    expect(normalizeAvatarUrl('https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp')).toBe(want);
    expect(normalizeAvatarUrl('https://drive.google.com/uc?export=view&id=1AbCdEfGhIjKlMnOp')).toBe(want);
  });
  it('fixes Dropbox and GitHub page links', () => {
    expect(normalizeAvatarUrl('https://www.dropbox.com/s/abc/me.jpg?dl=0')).toBe('https://www.dropbox.com/s/abc/me.jpg?raw=1');
    expect(normalizeAvatarUrl('https://github.com/a/b/blob/main/me.png')).toBe('https://raw.githubusercontent.com/a/b/main/me.png');
  });
  it('leaves direct image links alone', () => {
    expect(normalizeAvatarUrl(' https://i.imgur.com/x.png ')).toBe('https://i.imgur.com/x.png');
  });
});

describe('effectiveStatus', () => {
  const now = Date.parse('2026-11-21T15:50:00Z');
  it('goes live once the IDP time passes and stays live until finished', () => {
    expect(effectiveStatus({ status: 'scheduled', startAt: new Date(now + 60_000) }, now)).toBe('scheduled');
    expect(effectiveStatus({ status: 'notified', startAt: new Date(now) }, now)).toBe('live');
    expect(effectiveStatus({ status: 'scheduled', startAt: new Date(now - 3600_000) }, now)).toBe('live');
    expect(effectiveStatus({ status: 'done', startAt: new Date(now - 3600_000) }, now)).toBe('done');
    expect(effectiveStatus({ status: 'cancelled', startAt: new Date(now - 3600_000) }, now)).toBe('cancelled');
  });
});

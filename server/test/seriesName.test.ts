import { describe, expect, it } from 'vitest';
import { normalizeLink, seriesKey } from '../src/lib/seriesName.js';

describe('scrim series names', () => {
  it('ignores case, spaces and punctuation', () => {
    expect(seriesKey('EG Daily Scrims')).toBe('egdailyscrims');
    expect(seriesKey('  eg daily-scrims! ')).toBe('egdailyscrims');
    expect(seriesKey('Tortuga Scrims')).not.toBe(seriesKey('EG Daily Scrims'));
    expect(seriesKey('')).toBe('');
    expect(seriesKey(null)).toBe('');
  });
});

describe('organizer links', () => {
  it('adds https to bare invites', () => {
    expect(normalizeLink('discord.gg/abc123')).toBe('https://discord.gg/abc123');
    expect(normalizeLink('https://discord.com/channels/1/2')).toBe('https://discord.com/channels/1/2');
    expect(normalizeLink('  ')).toBe('');
  });
  it('rejects things that are not links', () => {
    expect(() => normalizeLink('javascript:alert(1)')).toThrow();
    expect(() => normalizeLink('hello')).toThrow();
  });
});

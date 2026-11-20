import { describe, expect, it } from 'vitest';
import { matchPlayer, normalizeIgn, scoreMvp } from '../src/lib/mvp.js';

describe('MVP score', () => {
  // Numbers from a real results screen: VASANTH got the in-game MVP.
  const rows = [
    { userId: 'bittu', kills: 1, assists: 1, damage: 151, survivalMin: 20.2 },
    { userId: 'dheeraj', kills: 0, assists: 0, damage: 0, survivalMin: 12.4 },
    { userId: 'vasanth', kills: 1, assists: 1, damage: 550, survivalMin: 20.1 },
    { userId: 'vignesh', kills: 1, assists: 1, damage: 136, survivalMin: 20.2 },
  ];

  it('weights finishes 40, damage 30, survival 20, assists 10 against the squad best', () => {
    const { rows: out, mvpUserId } = scoreMvp(rows);
    expect(mvpUserId).toBe('vasanth');
    expect(out.find((r) => r.userId === 'vasanth')!.mvpScore).toBeCloseTo(99.9, 1);
    expect(out.find((r) => r.userId === 'bittu')!.mvpScore).toBeCloseTo(78.2, 1);
    expect(out.filter((r) => r.mvp)).toHaveLength(1);
  });

  it('gives no MVP when everyone is at zero', () => {
    expect(scoreMvp([{ userId: 'a', kills: 0, assists: 0, damage: 0, survivalMin: 0 }]).mvpUserId).toBeNull();
  });
});

describe('IGN matching', () => {
  const players = [
    { id: '1', ign: 'RARE丨BITTU' }, { id: '2', ign: 'RARE丨DHEERAJ' }, { id: '3', ign: 'Vasanth', name: 'Vasanth' },
  ];
  it('ignores separators and case', () => {
    expect(normalizeIgn('RARE | BITTU')).toBe(normalizeIgn('RARE丨BITTU'));
    expect(matchPlayer('RARE | BITTU', players)?.id).toBe('1');
    expect(matchPlayer('rare|dheeraj', players)?.id).toBe('2');
  });
  it('matches without the team tag', () => {
    expect(matchPlayer('RARE | VASANTH', players)?.id).toBe('3');
  });
  it('returns null for strangers', () => {
    expect(matchPlayer('ENEMY | GHOST', players)).toBeNull();
  });
});

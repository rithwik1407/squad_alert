import type { MatchMap } from '@/lib/types';
import { cx } from './ui';

/** Stylised top-down map art (pure SVG, no image downloads). */
const PALETTE: Record<MatchMap, { a: string; b: string; c: string; land: string; tag: string }> = {
  Erangel: { a: '#2d4a2b', b: '#4f7a3a', c: '#7fa35a', land: '#1c3a52', tag: '8×8 · Classic' },
  Miramar: { a: '#5a3a1e', b: '#a8693a', c: '#e2a35e', land: '#3a2410', tag: '8×8 · Desert' },
  Rondo: { a: '#3a2f4a', b: '#7a5a8a', c: '#d9a066', land: '#162a44', tag: '8×8 · Neon city' },
  Sanhok: { a: '#0f4a3a', b: '#1f7a55', c: '#4fbf7a', land: '#0d3b4a', tag: '4×4 · Jungle' },
  Vikendi: { a: '#3a4a5e', b: '#8fa6c2', c: '#e6eef7', land: '#1d2c40', tag: '6×6 · Snow' },
  Livik: { a: '#2a4a3a', b: '#5a8a5a', c: '#e0b04a', land: '#13405a', tag: '2×2 · Fast' },
  TBD: { a: '#1f1f2b', b: '#2a2a3a', c: '#3a3a4d', land: '#111118', tag: 'Decide later' },
};

export function MapArt({ map, className }: { map: MatchMap; className?: string }) {
  const p = PALETTE[map] ?? PALETTE.Erangel;
  const id = `m-${map}`;
  return (
    <svg viewBox="0 0 320 180" className={cx('h-full w-full', className)} preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <linearGradient id={`${id}-g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={p.c} /><stop offset=".5" stopColor={p.b} /><stop offset="1" stopColor={p.a} />
        </linearGradient>
        <pattern id={`${id}-grid`} width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M20 0H0V20" fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="1" />
        </pattern>
        <linearGradient id={`${id}-fade`} x1="0" y1="0" x2="0" y2="1">
          <stop offset=".35" stopColor="#07070a" stopOpacity="0" /><stop offset="1" stopColor="#07070a" stopOpacity=".92" />
        </linearGradient>
      </defs>
      <rect width="320" height="180" fill={p.land} />
      <path d="M-10 40 C 40 10, 90 30, 120 20 S 210 -5, 250 25 S 330 30, 340 60 L 340 150 C 300 175, 250 150, 210 170 S 120 190, 80 160 S -10 170, -10 130 Z" fill={`url(#${id}-g)`} />
      <path d="M40 70 C 80 50, 120 90, 160 70 S 240 60, 280 90" fill="none" stroke="rgba(0,0,0,.25)" strokeWidth="6" strokeLinecap="round" />
      <path d="M60 120 C 110 100, 150 140, 200 120 S 260 110, 300 130" fill="none" stroke="rgba(255,255,255,.18)" strokeWidth="2" strokeDasharray="4 6" />
      {[[70, 60], [150, 95], [230, 70], [110, 135], [255, 125]].map(([x, y], i) => (
        <g key={i}><rect x={x} y={y} width="8" height="8" fill="rgba(0,0,0,.35)" /><rect x={x + 10} y={y + 3} width="5" height="5" fill="rgba(0,0,0,.3)" /></g>
      ))}
      <rect width="320" height="180" fill={`url(#${id}-grid)`} />
      {map === 'TBD' && (
        <text x="160" y="104" textAnchor="middle" fontSize="64" fontWeight="700" fill="rgba(255,169,77,.35)" fontFamily="Rajdhani, sans-serif">?</text>
      )}
      <rect width="320" height="180" fill={`url(#${id}-fade)`} />
    </svg>
  );
}

export const mapTag = (m: MatchMap) => PALETTE[m]?.tag ?? '';

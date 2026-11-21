import { useId, useState, type ReactNode } from 'react';
import type { MatchMap } from '@/lib/types';
import { cx } from './ui';

/**
 * Illustrated top-down map art (pure SVG, no downloads).
 * Each live map has its own drawing: Erangel's river and Military island, Miramar's desert ridges, Rondo's neon city.
 * Drawn on a 320×180 canvas with the landmarks kept in the middle, so they stay in frame whether the slot is a
 * narrow card thumbnail (sliced to the centre) or a wide hero banner.
 */
const META: Record<MatchMap, { sea: string; tag: string }> = {
  Erangel: { sea: '#17344a', tag: '8×8 · Classic' },
  Miramar: { sea: '#1d3346', tag: '8×8 · Desert' },
  Rondo: { sea: '#101a33', tag: '8×8 · Neon City' },
  Sanhok: { sea: '#0d3b4a', tag: '4×4 · Jungle' },
  Vikendi: { sea: '#1d2c40', tag: '6×6 · Snow' },
  Livik: { sea: '#13405a', tag: '2×2 · Fast' },
  TBD: { sea: '#111118', tag: 'Decide later' },
};

const Town = ({ x, y, n = 5, c = 'rgba(245,235,215,.8)', s = 4 }: { x: number; y: number; n?: number; c?: string; s?: number }) => (
  <g fill={c}>
    {Array.from({ length: n }, (_, i) => (
      <rect key={i} x={x + ((i * 7) % 15) - 7} y={y + ((i * 5) % 11) - 5} width={s + (i % 2)} height={s} />
    ))}
  </g>
);

function Erangel({ id }: { id: string }) {
  return (
    <>
      <defs>
        <linearGradient id={`${id}-land`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7fa35a" /><stop offset=".55" stopColor="#5b8a3e" /><stop offset="1" stopColor="#3f6a2e" />
        </linearGradient>
      </defs>
      {/* Main island */}
      <path d="M58 22 C 100 8, 170 14, 222 10 S 292 22, 300 54 C 308 88, 296 112, 282 130 C 262 140, 236 128, 214 132 C 186 138, 160 126, 132 134 C 104 142, 76 136, 60 118 C 40 96, 34 62, 58 22 Z" fill={`url(#${id}-land)`} />
      {/* Military island in the south */}
      <path d="M150 150 C 176 140, 222 142, 246 150 C 262 156, 258 170, 238 174 C 210 178, 170 176, 152 168 C 140 162, 140 154, 150 150 Z" fill={`url(#${id}-land)`} />
      {/* Forests */}
      <g fill="rgba(28,58,26,.55)">
        <ellipse cx="96" cy="60" rx="22" ry="12" /><ellipse cx="248" cy="44" rx="20" ry="10" /><ellipse cx="200" cy="104" rx="16" ry="9" />
      </g>
      {/* River from the north-west down to the southern channel */}
      <path d="M84 12 C 96 40, 118 54, 120 82 C 122 104, 108 118, 120 136 C 140 146, 200 136, 262 140" fill="none" stroke="#2a5674" strokeWidth="6" strokeLinecap="round" />
      {/* Bridges to Military */}
      <g stroke="#cdbb92" strokeWidth="2.5"><path d="M176 134 L 178 148" /><path d="M232 130 L 230 146" /></g>
      {/* Roads */}
      <path d="M70 92 C 110 84, 150 96, 172 76 S 236 64, 284 82 M172 76 C 168 54, 186 36, 216 28" fill="none" stroke="rgba(230,210,160,.55)" strokeWidth="1.6" />
      {/* Towns: Georgopol, Pochinki, School, Yasnaya, Military Base */}
      <Town x={74} y={50} n={7} /><Town x={170} y={80} n={8} /><Town x={196} y={56} n={4} /><Town x={262} y={64} n={6} /><Town x={208} y={160} n={7} />
    </>
  );
}

function Miramar({ id }: { id: string }) {
  return (
    <>
      <defs>
        <linearGradient id={`${id}-land`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f0c07a" /><stop offset=".5" stopColor="#d4914e" /><stop offset="1" stopColor="#a8643a" />
        </linearGradient>
      </defs>
      {/* Desert covers almost everything, sea only on the edges */}
      <path d="M18 8 L 304 6 C 314 40, 312 90, 306 130 C 300 160, 290 176, 260 178 L 40 178 C 20 160, 10 120, 14 80 C 16 50, 10 26, 18 8 Z" fill={`url(#${id}-land)`} />
      {/* Mountain ridges as contour rings */}
      <g fill="none" stroke="rgba(90,50,24,.45)" strokeWidth="1.4">
        <path d="M60 30 c 30 -8 54 8 50 26 s -40 24 -58 10 s -16 -30 8 -36 Z" />
        <path d="M70 38 c 18 -4 32 6 28 16 s -24 14 -34 6 s -8 -18 6 -22 Z" />
        <path d="M228 108 c 34 -10 62 6 58 26 s -44 26 -64 12 s -18 -32 6 -38 Z" />
        <path d="M240 118 c 20 -6 36 4 32 16 s -26 14 -38 6 s -10 -18 6 -22 Z" />
        <path d="M232 22 c 22 -6 40 4 38 18 s -28 18 -42 8 s -12 -22 4 -26 Z" />
      </g>
      <g fill="rgba(120,66,30,.35)"><ellipse cx="79" cy="47" rx="10" ry="6" /><ellipse cx="256" cy="128" rx="12" ry="7" /></g>
      {/* Dry river bed */}
      <path d="M150 6 C 142 40, 166 64, 152 92 S 128 140, 150 178" fill="none" stroke="rgba(110,70,40,.55)" strokeWidth="4" strokeDasharray="1 0" />
      {/* Roads */}
      <path d="M24 96 C 80 90, 120 104, 170 94 S 250 70, 304 78 M170 94 C 180 120, 200 140, 190 176" fill="none" stroke="rgba(255,240,210,.6)" strokeWidth="1.6" strokeDasharray="5 3" />
      {/* Towns: Pecado (centre), Los Leones, San Martín, El Pozo */}
      <Town x={176} y={92} n={9} c="rgba(80,40,18,.75)" /><Town x={200} y={150} n={8} c="rgba(80,40,18,.75)" /><Town x={118} y={60} n={5} c="rgba(80,40,18,.75)" /><Town x={58} y={128} n={6} c="rgba(80,40,18,.75)" />
    </>
  );
}

function Rondo({ id }: { id: string }) {
  return (
    <>
      <defs>
        <linearGradient id={`${id}-land`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6fa86a" /><stop offset=".6" stopColor="#4a8452" /><stop offset="1" stopColor="#30603e" />
        </linearGradient>
        <radialGradient id={`${id}-glow`} cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#ff4fa8" stopOpacity=".75" /><stop offset=".6" stopColor="#7a3aff" stopOpacity=".25" /><stop offset="1" stopColor="#7a3aff" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* Island */}
      <path d="M40 30 C 90 6, 170 16, 230 12 C 280 10, 306 40, 300 80 C 296 120, 300 150, 262 166 C 220 180, 150 170, 100 172 C 56 174, 22 148, 24 108 C 26 76, 16 50, 40 30 Z" fill={`url(#${id}-land)`} />
      {/* Rice terraces in the west */}
      <g fill="none" stroke="rgba(200,230,150,.45)" strokeWidth="1.2">
        <path d="M44 70 q 22 -10 44 0" /><path d="M42 80 q 24 -10 48 0" /><path d="M42 90 q 24 -10 48 0" /><path d="M46 100 q 22 -10 42 0" />
      </g>
      {/* Lake and river */}
      <ellipse cx="240" cy="52" rx="22" ry="12" fill="#244a6e" />
      <path d="M240 64 C 232 90, 250 110, 236 140 S 210 166, 214 176" fill="none" stroke="#244a6e" strokeWidth="5" strokeLinecap="round" />
      {/* Jadena: neon city grid in the centre */}
      <circle cx="160" cy="96" r="52" fill={`url(#${id}-glow)`} />
      <g>
        {Array.from({ length: 16 }, (_, i) => {
          const x = 134 + (i % 4) * 13;
          const y = 76 + Math.floor(i / 4) * 11;
          return <rect key={i} x={x} y={y} width="9" height="7" rx="1" fill={i % 3 === 0 ? '#ff6fbf' : i % 3 === 1 ? '#5fe4ff' : '#2a2140'} opacity=".9" />;
        })}
      </g>
      {/* Roads */}
      <path d="M30 120 C 80 118, 110 100, 160 96 S 240 104, 296 96 M160 96 C 150 60, 170 34, 150 14" fill="none" stroke="rgba(255,230,200,.5)" strokeWidth="1.6" />
      <Town x={86} y={140} n={6} /><Town x={262} y={140} n={6} /><Town x={110} y={36} n={5} />
    </>
  );
}

/** Older maps kept only so past matches still render. */
function Generic({ id, a, b, c }: { id: string; a: string; b: string; c: string }) {
  return (
    <>
      <defs>
        <linearGradient id={`${id}-land`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={c} /><stop offset=".5" stopColor={b} /><stop offset="1" stopColor={a} />
        </linearGradient>
      </defs>
      <path d="M-10 40 C 40 10, 90 30, 120 20 S 210 -5, 250 25 S 330 30, 340 60 L 340 150 C 300 175, 250 150, 210 170 S 120 190, 80 160 S -10 170, -10 130 Z" fill={`url(#${id}-land)`} />
      <Town x={90} y={70} n={6} /><Town x={200} y={100} n={6} />
    </>
  );
}

const DRAW: Record<MatchMap, (id: string) => ReactNode> = {
  Erangel: (id) => <Erangel id={id} />,
  Miramar: (id) => <Miramar id={id} />,
  Rondo: (id) => <Rondo id={id} />,
  Sanhok: (id) => <Generic id={id} a="#0f4a3a" b="#1f7a55" c="#4fbf7a" />,
  Vikendi: (id) => <Generic id={id} a="#3a4a5e" b="#8fa6c2" c="#e6eef7" />,
  Livik: (id) => <Generic id={id} a="#2a4a3a" b="#5a8a5a" c="#e0b04a" />,
  TBD: () => null,
};

/**
 * Real map images (client/public/maps). Cropped to the playable island; objectPosition keeps the
 * busiest part of each map in view when a wide banner or a narrow card thumbnail crops it.
 */
const PHOTO: Partial<Record<MatchMap, { src: string; pos: string }>> = {
  Erangel: { src: '/maps/erangel.webp', pos: '50% 55%' },
  Miramar: { src: '/maps/miramar.webp', pos: '50% 50%' },
  Rondo: { src: '/maps/rondo.webp', pos: '50% 50%' },
};

export function MapArt({ map, className }: { map: MatchMap; className?: string }) {
  const photo = PHOTO[map];
  const [broken, setBroken] = useState(false);
  if (photo && !broken) {
    return (
      <div className={cx('relative h-full w-full overflow-hidden bg-ink-900', className)} aria-hidden>
        <img src={photo.src} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setBroken(true)}
          className="absolute inset-0 h-full w-full object-cover saturate-[1.1] transition-transform duration-700 ease-out will-change-transform group-hover:scale-[1.06]"
          style={{ objectPosition: photo.pos }} />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent from-40% to-ink-950/90" />
      </div>
    );
  }
  return <DrawnMap map={map} className={className} />;
}

/** Drawn fallback: retired maps, TBD, or when an image fails to load. */
function DrawnMap({ map, className }: { map: MatchMap; className?: string }) {
  const id = `m${useId().replace(/:/g, '')}`;
  const meta = META[map] ?? META.TBD;
  const draw = DRAW[map] ?? DRAW.TBD;
  return (
    <svg viewBox="0 0 320 180" className={cx('h-full w-full', className)} preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <pattern id={`${id}-grid`} width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M20 0H0V20" fill="none" stroke="rgba(255,255,255,.07)" strokeWidth="1" />
        </pattern>
        <linearGradient id={`${id}-fade`} x1="0" y1="0" x2="0" y2="1">
          <stop offset=".45" stopColor="#07070a" stopOpacity="0" /><stop offset="1" stopColor="#07070a" stopOpacity=".85" />
        </linearGradient>
      </defs>
      <rect width="320" height="180" fill={meta.sea} />
      {draw(id)}
      <rect width="320" height="180" fill={`url(#${id}-grid)`} />
      {map === 'TBD' && (
        <text x="160" y="110" textAnchor="middle" fontSize="64" fontWeight="700" fill="rgba(255,169,77,.35)" fontFamily="Rajdhani, sans-serif">?</text>
      )}
      <rect width="320" height="180" fill={`url(#${id}-fade)`} />
    </svg>
  );
}

export const mapTag = (m: MatchMap) => META[m]?.tag ?? '';

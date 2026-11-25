/** Mirrors server/src/ai/blocks.ts: visual blocks the Squad AI tools draw on the dashboard. */
export type Tone = 'good' | 'bad' | 'warn' | 'info';

export interface Kpi { label: string; value: string | number; unit?: string; sub?: string; delta?: number | null; tone?: Tone }
export interface Series { key: string; label: string }
export type Row = Record<string, string | number | null>;

export type Block =
  | { type: 'kpis'; title: string; items: Kpi[] }
  | { type: 'bar' | 'line'; title: string; subtitle?: string; xKey: string; series: Series[]; data: Row[]; unit?: string }
  | { type: 'radar'; title: string; subtitle?: string; series: Series[]; data: Row[] }
  | { type: 'table'; title: string; subtitle?: string; columns: { key: string; label: string; align?: 'left' | 'right' }[]; rows: Row[]; best?: string[] }
  | { type: 'squad'; title: string; subtitle?: string; matchId: string | null; matchLabel: string | null; players: SquadPick[]; substitute: SquadPick | null; reason: string; note: string }
  | { type: 'report'; title: string; subtitle: string; matchId: string; placement: number | null; kills: number; damage: number; points: number; players: Row[]; observations: { tone: Tone; text: string }[]; recommendation: string }
  | { type: 'insights'; title: string; items: { tone: Tone; title: string; text: string; tags?: string[] }[] }
  | { type: 'heatmap'; title: string; subtitle?: string; rows: string[]; cols: string[]; values: (number | null)[][]; unit?: string }
  | { type: 'proposal'; id: string; kind: 'scrim' | 'squad'; title: string; lines: { label: string; value: string }[]; warnings: string[]; status: 'pending' | 'approved' | 'rejected' | 'expired' };

export interface SquadPick {
  id: string;
  ign: string;
  avatar: string;
  gameRole: string;
  score: number;
  availability: string;
  reasons: string[];
}

export type BlockWithId = Block & { id: string };

export type AiEvent =
  | { type: 'meta'; engine: 'gemini' | 'groq' | 'offline'; model?: string }
  | { type: 'text'; delta: string }
  | { type: 'tool'; id: string; name: string; label: string; status: 'start' | 'done' | 'error'; ms?: number }
  | { type: 'block'; block: BlockWithId }
  | { type: 'notice'; message: string }
  | { type: 'done' };

export interface AiUpcoming { id: string; title: string; event: string; map: string; type: string; startAt: string; label: string; time: string }

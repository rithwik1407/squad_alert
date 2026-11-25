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
  | ProposalBlock;

export type ProposalKind = 'scrim' | 'squad' | 'message' | 'reschedule' | 'cancel' | 'map' | 'availability' | 'request';
export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'expired';
export type Channel = 'telegram' | 'push';
export interface PoolPlayer { id: string; ign: string; gameRole?: string; availability?: string; telegram?: boolean; push?: boolean }

/** Mirrors ProposalForm in server/src/ai/blocks.ts: what the Approve form lets you edit. */
export type ProposalForm =
  | { kind: 'scrim'; tournamentName: string; title: string; date: string; time: string; map: string; type: string; maps: string[]; types: string[] }
  | { kind: 'squad'; matchId: string; matchLabel: string; selectedIds: string[]; pool: PoolPlayer[]; size: number }
  | { kind: 'message'; recipientIds: string[]; text: string; channels: Channel[]; pool: PoolPlayer[]; matchId?: string }
  | { kind: 'reschedule'; matchId: string; matchLabel: string; date: string; time: string }
  | { kind: 'cancel'; matchId: string; matchLabel: string }
  | { kind: 'map'; matchId: string; matchLabel: string; map: string; maps: string[] }
  | { kind: 'availability'; matchId: string; matchLabel: string; status: string; joinTime: string }
  | { kind: 'request'; text: string };

export interface ProposalBlock {
  type: 'proposal'; id: string; kind: ProposalKind; title: string; lines: { label: string; value: string }[]; warnings: string[]; status: ProposalStatus;
  approver?: 'captain' | 'self';
  createdBy?: string;
  /** Missing on cards made before v3: those approve as-is. */
  form?: ProposalForm;
  result?: string | null;
}

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
  | { type: 'turn'; id: string; conversationId: string }
  | { type: 'meta'; engine: string; label?: string; model?: string; tier?: 'light' | 'strong' }
  | { type: 'text'; delta: string }
  | { type: 'tool'; id: string; name: string; label: string; status: 'start' | 'done' | 'error'; ms?: number }
  | { type: 'block'; block: BlockWithId }
  | { type: 'notice'; message: string }
  | { type: 'done' };

export interface AiUpcoming { id: string; title: string; event: string; map: string; type: string; startAt: string; label: string; time: string }

export interface AiTurn {
  id: string;
  conversationId: string;
  question: string;
  text: string;
  tools: { id: string; label: string; status: 'start' | 'done' | 'error'; ms?: number }[];
  blocks: BlockWithId[];
  notice: string | null;
  engine: string | null;
  label: string | null;
  model: string | null;
  status: 'running' | 'done' | 'error' | 'stopped';
  live: boolean;
  at: string;
}

export interface AiHistoryItem { id: string; conversationId: string; question: string; status: AiTurn['status']; visuals: number; at: string; live: boolean }
export interface AiSuggestion { id: string; cat: string; q: string }

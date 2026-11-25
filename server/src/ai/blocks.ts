/**
 * Visual blocks the Squad AI sends to the dashboard. Tools build them from real data; the model never
 * writes them, so every number on screen comes straight from MongoDB. The client mirrors these types
 * in client/src/lib/aiTypes.ts.
 */
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

/** What the Approve form lets the person edit, by kind. Values are the AI's draft. */
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
  /** Who can approve: the captain, or the person who asked (their own check-in or request). */
  approver: 'captain' | 'self';
  createdBy: string;
  form: ProposalForm;
  /** What approving did, in plain words (e.g. "Sent to 3 of 4 by Telegram"). */
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

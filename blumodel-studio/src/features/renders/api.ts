import { call } from '../../lib/api';

/**
 * The renders API (server/routes/renders.mjs, docs/handoff/renders.md). Showroom hosts only: on
 * the sales site every one of these is a 404, so callers check they're on a showroom first.
 */

export type RenderStatus = 'pending' | 'done' | 'failed' | 'refunded';
export type RenderRole = 'owner' | 'staff' | 'visitor';
export type RenderReason = 'not_configured' | 'sign_in' | 'visitor_off' | 'daily_cap' | 'no_credits' | 'unavailable';

export interface RenderWire {
  id: string;
  status: RenderStatus;
  projectId: string | null;
  designName: string;
  provider: string;
  demo: boolean;
  costCents: number;
  /** One of the account's free renders: no credits were used. */
  free?: boolean;
  byRole: RenderRole;
  byName: string | null;
  mine: boolean;
  createdAt: number;
  finishedAt: number | null;
  error: string | null;
  imageUrl: string | null;
  inputUrl: string | null;
  width: number | null;
  height: number | null;
}

export interface RendersStatus {
  configured: boolean;
  provider: string | null;
  demo: boolean;
  costCents: number;
  role: RenderRole | null;
  canRender: boolean;
  reason: RenderReason | null;
  balanceCents: number | null;
  visitor: { enabled: boolean; left: number; dailyCap?: number; usedToday?: number };
  /** This account's free renders (config FREE_RENDERS, 3): the next render is free while left > 0. */
  free?: { total: number; left: number };
  maxImageMb: number;
}

/** The structured description sent with the image (server/renders/scene.mjs). */
export interface RenderScene {
  room: { kind: 'kitchen' | 'bathroom'; widthIn: number; lengthIn: number; ceilingIn: number };
  style?: string;
  finishes: Partial<Record<'cabinets' | 'doorStyle' | 'hardware' | 'countertop' | 'backsplash' | 'flooring' | 'walls', string>>;
  products: { name: string; brand: string; category: string; finish: string; count: number }[];
  camera: { view: 'current'; widthPx: number; heightPx: number };
}

export interface RenderUsage {
  total: number;
  thisMonth: number;
  visitorToday: number;
  failedThisMonth: number;
  spentThisMonthCents: number;
}

export interface CreditEntry {
  id: number;
  kind: 'grant' | 'expire' | 'reserve' | 'charge' | 'release' | 'refund' | 'adjust';
  cents: number;
  balanceAfter: number;
  holdId: string | null;
  ref: string | null;
  note: string;
  by: string | null;
  at: number;
}

export interface CreditLot {
  id: string;
  source: string;
  cents: number;
  remaining: number;
  expiresAt: number;
  createdAt: number;
}

export interface WorkspaceCredits {
  balanceCents: number;
  lots: CreditLot[];
  nextExpiry: { at: number; cents: number } | null;
  heldCents: number;
  renderCostCents: number;
  rolloverMonths: number;
  history: CreditEntry[];
}

export interface WorkspaceRenders {
  renders: RenderWire[];
  more: boolean;
  usage: RenderUsage;
  costCents: number;
  configured: boolean;
  provider: string | null;
}

const q = (o: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const rendersApi = {
  status: () => call<RendersStatus>('GET', '/api/renders/status'),
  start: (body: { projectId?: string; shareToken?: string; image: string; scene: RenderScene }) => call<{ render: RenderWire }>('POST', '/api/renders', body),
  get: (id: string) => call<{ render: RenderWire }>('GET', `/api/renders/${encodeURIComponent(id)}`),
  list: (o: { projectId?: string; shareToken?: string; before?: number; limit?: number } = {}) => call<{ renders: RenderWire[]; more: boolean }>('GET', `/api/renders${q(o)}`),
  hide: (id: string) => call<{ ok: true }>('DELETE', `/api/renders/${encodeURIComponent(id)}`),
  workspace: (o: { before?: number; limit?: number } = {}) => call<WorkspaceRenders>('GET', `/api/workspace/renders${q(o)}`),
  credits: (o: { before?: number } = {}) => call<WorkspaceCredits>('GET', `/api/workspace/credits${q(o)}`),
};

/** The owner's admin panel API (server/routes/adminPanel.mjs). Writes go through `call` (CSRF header). */
import { call } from '../../lib/api';
import type { AuditPage, ContractorRow, Dashboard, PanelUser, RenderServiceState, SitesState, SystemStatus, UpdatesStatus, UserDetail } from './types';

const enc = encodeURIComponent;
const qs = (o: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const adminApi = {
  dashboard: () => call<Dashboard>('GET', '/api/admin/dashboard'),
  users: (q = '') => call<{ users: PanelUser[] }>('GET', `/api/admin/users${qs({ q: q.trim() })}`),
  user: (id: string) => call<UserDetail>('GET', `/api/admin/users/${enc(id)}`),
  setRole: (id: string, role: 'customer' | 'studio') => call<UserDetail>('POST', `/api/admin/users/${enc(id)}/role`, { role }),
  grantComp: (id: string, plan: 'unlimited' | 'contractor', endsOn: string | null, note: string) =>
    call<UserDetail>('POST', `/api/admin/users/${enc(id)}/comp`, { plan, endsOn, note }),
  revokeComp: (id: string) => call<UserDetail>('POST', `/api/admin/users/${enc(id)}/comp/revoke`),
  signOutAll: (id: string) => call<UserDetail & { ended: number }>('POST', `/api/admin/users/${enc(id)}/sign-out`),
  disable: (id: string, reason: string) => call<UserDetail>('POST', `/api/admin/users/${enc(id)}/disable`, { reason }),
  enable: (id: string) => call<UserDetail>('POST', `/api/admin/users/${enc(id)}/enable`),
  remove: (id: string, confirm: string) => call<{ deleted: true }>('POST', `/api/admin/users/${enc(id)}/delete`, { confirm }),
  contractors: (q = '') => call<{ contractors: ContractorRow[] }>('GET', `/api/admin/contractors${qs({ q: q.trim() })}`),
  verifyContractor: (id: string, verified: boolean) => call<{ contractor: ContractorRow | null }>('POST', `/api/admin/contractors/${enc(id)}/verify`, { verified }),
  /** The existing extra-models grant (server/routes/orders.mjs). */
  grantModels: (userId: string, models: number, note: string) => call<unknown>('POST', '/api/admin/model-grants', { userId, models, note }),
  system: () => call<SystemStatus>('GET', '/api/admin/system'),
  /** Every site on, or off for maintenance (audited). */
  setSites: (on: boolean) => call<{ sites: SitesState; changed: boolean }>('POST', '/api/admin/system/sites', { on }),
  /** Leaves the Update now trigger for the automatic update (audited). */
  updateNow: () => call<{ requested: true; alreadyPending: boolean; updates: UpdatesStatus }>('POST', '/api/admin/system/update-now'),
  /** The render service (address and key; the key is only ever sent, never received). */
  renderService: () => call<{ renders: RenderServiceState }>('GET', '/api/admin/system/renders'),
  setRenderService: (key?: string) => call<{ renders: RenderServiceState }>('POST', '/api/admin/system/renders', key ? { key } : {}),
  removeRenderService: () => call<{ renders: RenderServiceState }>('POST', '/api/admin/system/renders/remove'),
  testRenderService: () => call<{ ok: boolean; message: string; ms?: number; provider?: string }>('POST', '/api/admin/system/renders/test'),
  audit: (f: { actor?: string; action?: string; from?: string; to?: string; page?: number }) => call<AuditPage>('GET', `/api/admin/audit${qs(f)}`),
};

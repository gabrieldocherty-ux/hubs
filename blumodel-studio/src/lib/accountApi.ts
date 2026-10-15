/**
 * Account settings and password resets (server/routes/account.mjs and auth.mjs). Every write goes
 * through `call`, which carries the CSRF header.
 */
import { call, type User } from './api';
import type { ThemePref } from './theme';

export interface AccountPrefs {
  theme: ThemePref;
  /** The editor's cost estimator (Est. chip, Estimate tab, totals). Off unless the person turns it on. */
  showEstimator: boolean;
  /** Email me when a new browser signs in (only sent when the server has an email provider). */
  signInAlerts: boolean;
}

export interface PrefsWire {
  prefs: AccountPrefs;
  /** False while the person has never changed one. */
  saved: boolean;
  /** The server can send email (a provider is configured). */
  emailEnabled: boolean;
}

export interface ProfileWire {
  name: string;
  email: string;
  phone: string;
  createdAt: number;
}

export interface DeviceWire {
  id: string;
  current: boolean;
  browser: string;
  os: string;
  createdAt: number | null;
  lastSeenAt: number | null;
  expiresAt: number;
}

export interface ResetOptions {
  /** Reset links are emailed; otherwise the person writes to support and an admin makes one. */
  emailEnabled: boolean;
  supportEmail: string | null;
}

export const accountApi = {
  prefs: () => call<PrefsWire>('GET', '/api/account/prefs'),
  savePrefs: (patch: Partial<AccountPrefs>) => call<PrefsWire>('PATCH', '/api/account/prefs', patch),
  profile: () => call<{ profile: ProfileWire }>('GET', '/api/account/profile'),
  saveProfile: (patch: { name?: string; phone?: string }) => call<{ profile: ProfileWire; user: User }>('PATCH', '/api/account/profile', patch),
  changeEmail: (email: string, password: string) => call<{ user: User; signedOut: number }>('POST', '/api/account/email', { email, password }),
  sessions: () => call<{ sessions: DeviceWire[] }>('GET', '/api/account/sessions'),
  endSession: (id: string) => call<void>('DELETE', `/api/account/sessions/${encodeURIComponent(id)}`),
  endOtherSessions: () => call<{ signedOut: number }>('POST', '/api/account/sessions/sign-out-others'),

  resetOptions: () => call<ResetOptions>('GET', '/api/auth/forgot'),
  forgot: (email: string) => call<{ ok: true }>('POST', '/api/auth/forgot', { email }),
  checkReset: (token: string) => call<{ valid: boolean; email?: string }>('POST', '/api/auth/reset/check', { token }),
  reset: (token: string, password: string) => call<{ user: User }>('POST', '/api/auth/reset', { token, password }),
  adminResetLink: (userId: string) => call<{ url: string; expiresAt: number }>('POST', `/api/admin/users/${encodeURIComponent(userId)}/reset-link`),
};

/** "Edge on Windows", "Safari", "Unknown browser". */
export function deviceName(d: Pick<DeviceWire, 'browser' | 'os'>): string {
  if (d.browser && d.os) return `${d.browser} on ${d.os}`;
  return d.browser || d.os || 'Unknown browser';
}

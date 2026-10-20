import { useEffect } from 'react';
import { create } from 'zustand';
import { ApiError, call } from '../../lib/api';
import { normalizePhone } from '../../lib/phone';
import { useConfig } from '../../lib/config';

/**
 * "Before you start" (docs/handoff/leads.md): on a showroom a visitor gives a name and an email or
 * phone before designing. The server keeps them as a lead of the company's and answers with a
 * visitor cookie (httpOnly, so this page never sees it) that owns the designs made on this
 * browser, so they save to the server without an account. This store holds what the visitor
 * typed (GET /api/visitor) for the screens that need it: the gate, Send this design, the editor.
 */

export interface Visitor {
  name: string;
  email: string;
  phone: string;
  consentText: string;
  since: number;
}

interface VisitorState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  visitor: Visitor | null;
  /** False for the showroom's own team: they never see the form. */
  required: boolean;
}

export const useVisitorStore = create<VisitorState>()(() => ({ status: 'idle', visitor: null, required: true }));

let inflight: Promise<void> | null = null;

/** Asks the server who this browser is (again with `force`, after signing in or out). Never throws. */
export function loadVisitor(force = false): Promise<void> {
  const s = useVisitorStore.getState();
  if (!force && (s.status === 'ready' || s.status === 'loading')) return inflight ?? Promise.resolve();
  if (useConfig.getState().config?.site !== 'showroom') {
    useVisitorStore.setState({ status: 'ready', visitor: null, required: false });
    return Promise.resolve();
  }
  useVisitorStore.setState({ status: 'loading' });
  const p = call<{ visitor: Visitor | null; required: boolean }>('GET', '/api/visitor')
    .then((r) => useVisitorStore.setState({ status: 'ready', visitor: r.visitor, required: r.required }))
    .catch(() => useVisitorStore.setState({ status: 'error' }))
    .finally(() => {
      if (inflight === p) inflight = null;
    });
  inflight = p;
  return p;
}

/** The visitor on this showroom (null until known, and on the sales site). */
export function useVisitor(): Visitor | null {
  const site = useConfig((s) => s.config?.site ?? null);
  const status = useVisitorStore((s) => s.status);
  const visitor = useVisitorStore((s) => s.visitor);
  useEffect(() => {
    if (site === 'showroom' && status === 'idle') void loadVisitor();
  }, [site, status]);
  return site === 'showroom' ? visitor : null;
}

/** The same outside React. */
export const currentVisitor = (): Visitor | null => useVisitorStore.getState().visitor;

// ── the form ──────────────────────────────────────────────────────────────

export interface StartDraft {
  name: string;
  email: string;
  phone: string;
  consent: boolean;
}

export type StartField = keyof StartDraft | 'contact';
export type StartErrors = Partial<Record<StartField, string>>;

export const EMPTY_START: StartDraft = { name: '', email: '', phone: '', consent: false };

/**
 * The words next to the box, stored with the lead. The server has its own copy
 * (startConsentText in server/tenancy/leads.mjs); a test keeps the two identical.
 */
export const startConsentText = (company: string) => `${company} may contact me about my design.`;

// The same shape rule as the server (server/lib/emailCheck.mjs): a real domain with a letters-only ending, no "..", no stray dots.
const EMAIL = /^(?!\.)(?!.*\.\.)[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}(?<!\.)@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,24}$/;
const one = (v: string, max: number) => v.replace(/\s+/g, ' ').trim().slice(0, max);

/** Field errors, worded like the server's (checkContact); empty when the form can go. */
export function checkStart(d: StartDraft, company: string): StartErrors {
  const e: StartErrors = {};
  const email = one(d.email, 254).toLowerCase();
  const phone = normalizePhone(d.phone);
  if (!one(d.name, 100)) e.name = 'Tell us your name.';
  if (email && (!EMAIL.test(email) || /[\r\n,;<>]/.test(email))) e.email = 'That email address doesn’t look right.';
  if (!phone.ok) e.phone = phone.reason;
  if (!email && phone.ok && !phone.value) e.contact = `Give an email or a phone number so ${company} can reach you.`;
  if (!d.consent) e.consent = `Tick the box so ${company} can contact you.`;
  return e;
}

/** What POST /api/visitor takes. The phone goes as typed: the server normalises it the same way. */
export function startBody(d: StartDraft, honeypot = '') {
  return { name: one(d.name, 100), email: one(d.email, 254).toLowerCase(), phone: one(d.phone, 40), consent: true as const, website: honeypot };
}

/** The server's field errors on a 400, for this form's fields. */
export function startServerErrors(body: unknown): StartErrors {
  const list = (body as { errors?: { field?: unknown; message?: unknown }[] } | null)?.errors;
  const out: StartErrors = {};
  if (!Array.isArray(list)) return out;
  for (const x of list) if (typeof x?.field === 'string' && typeof x.message === 'string' && ['name', 'email', 'phone', 'contact', 'consent'].includes(x.field)) out[x.field as StartField] = x.message;
  return out;
}

/** Sends the form; the visitor is known from then on. Throws ApiError. */
export async function startVisiting(d: StartDraft, honeypot = ''): Promise<Visitor> {
  const r = await call<{ visitor: Visitor }>('POST', '/api/visitor', startBody(d, honeypot));
  useVisitorStore.setState({ status: 'ready', visitor: r.visitor, required: true });
  return r.visitor;
}

/** "Not you?": this browser forgets the visitor (the company keeps the lead). */
export async function forgetVisitor(): Promise<void> {
  try {
    await call('DELETE', '/api/visitor');
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
  }
  useVisitorStore.setState({ status: 'ready', visitor: null });
}

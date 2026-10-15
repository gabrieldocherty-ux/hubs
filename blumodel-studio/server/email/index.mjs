// Outgoing email: password-reset links and account security notices. Two providers, both called
// with plain fetch (no SDK, no new dependency):
//
//   Resend    RESEND_API_KEY=re_...      POST https://api.resend.com/emails
//   Postmark  POSTMARK_TOKEN=<server token>  POST https://api.postmarkapp.com/email
//
// plus EMAIL_FROM, the sender ("BluModel Studio <hello@blumodel.studio>", an address the provider
// has verified). With a key and EMAIL_FROM the provider is on; with both keys Resend is used. With
// neither (or no EMAIL_FROM) the provider is 'none': nothing is ever sent, the sign-in page says to
// contact support and admins make reset links in Admin > Users.
//
// Secrets: the key goes into one request header and nowhere else. Nothing here logs a key, a
// recipient address, a subject, a body or a provider's response text: a failure is logged as the
// provider's name and the HTTP status (or the error's name) only.

import { EMAIL_RE } from '../auth/userWire.mjs';

const RESEND_URL = 'https://api.resend.com/emails';
const POSTMARK_URL = 'https://api.postmarkapp.com/email';
const TIMEOUT_MS = 10_000;

/** "Name <addr>" or "addr", one line. */
const FROM_RE = /^(?:[^<>\r\n]{1,80}\s<[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>|[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+)$/;

/**
 * Which provider this server uses, and why, from the config's RESEND_API_KEY, POSTMARK_TOKEN and
 * EMAIL_FROM. `notes` are plain sentences for the log: never a key or any part of one.
 * @param {{ RESEND_API_KEY?: string, POSTMARK_TOKEN?: string, EMAIL_FROM?: string }} config
 * @returns {{ provider: 'resend' | 'postmark' | 'none', from: string, notes: string[] }}
 */
export function emailSettings(config = {}) {
  const resend = String(config.RESEND_API_KEY ?? '').trim();
  const postmark = String(config.POSTMARK_TOKEN ?? '').trim();
  const from = String(config.EMAIL_FROM ?? '').trim();
  const notes = [];
  if (!resend && !postmark) {
    notes.push('Email: none (RESEND_API_KEY or POSTMARK_TOKEN not set). Password resets go through an admin (Admin > Users > Create reset link).');
    return { provider: 'none', from: '', notes };
  }
  if (!from) {
    notes.push('Email: off. An email key is set but EMAIL_FROM is not (the sender, e.g. BluModel Studio <hello@blumodel.studio>).');
    return { provider: 'none', from: '', notes };
  }
  if (!FROM_RE.test(from)) {
    notes.push('Email: off. EMAIL_FROM is not an address or "Name <address>".');
    return { provider: 'none', from: '', notes };
  }
  if (resend && postmark) notes.push('Email: both RESEND_API_KEY and POSTMARK_TOKEN are set; Resend is used.');
  const provider = resend ? 'resend' : 'postmark';
  notes.push(`Email: ${provider === 'resend' ? 'Resend' : 'Postmark'} (password-reset links and account notices are emailed).`);
  return { provider, from, notes };
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Plain text to a minimal HTML body: paragraphs, and URLs as links. */
export function textToHtml(text) {
  const paras = String(text)
    .split(/\n{2,}/)
    .map((p) =>
      escapeHtml(p)
        .replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}">${u}</a>`)
        .replace(/\n/g, '<br>'),
    );
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.5;color:#211e1a">${paras.map((p) => `<p>${p}</p>`).join('')}</div>`;
}

/**
 * @param {{ config: any, fetch?: typeof fetch, log?: { info?: Function, warn?: Function, error?: Function } }} deps
 */
export function createMailer({ config, fetch: fetchImpl = globalThis.fetch, log = console } = {}) {
  const settings = emailSettings(config);
  const { provider, from } = settings;

  /**
   * Sends one message. Resolves `{ ok, status }` and never throws: a failed send is logged (status
   * only) and reported to the caller, which decides what the person sees.
   * @param {{ to: string, subject: string, text: string }} msg
   */
  async function send({ to, subject, text }) {
    if (provider === 'none') return { ok: false, status: 0, reason: 'none' };
    const rcpt = String(to ?? '').trim();
    if (!EMAIL_RE.test(rcpt) || /[\r\n,;<>]/.test(rcpt) || rcpt.length > 254) return { ok: false, status: 0, reason: 'bad_recipient' };
    const subj = String(subject ?? '').replace(/[\r\n]+/g, ' ').slice(0, 200);
    const body = String(text ?? '');
    const html = textToHtml(body);
    let req;
    if (provider === 'resend') {
      req = {
        url: RESEND_URL,
        headers: { Authorization: `Bearer ${String(config.RESEND_API_KEY).trim()}`, 'Content-Type': 'application/json' },
        body: { from, to: [rcpt], subject: subj, text: body, html },
      };
    } else {
      req = {
        url: POSTMARK_URL,
        headers: { 'X-Postmark-Server-Token': String(config.POSTMARK_TOKEN).trim(), Accept: 'application/json', 'Content-Type': 'application/json' },
        body: { From: from, To: rcpt, Subject: subj, TextBody: body, HtmlBody: html, MessageStream: 'outbound' },
      };
    }
    try {
      const res = await fetchImpl(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body), signal: AbortSignal.timeout(TIMEOUT_MS) });
      // Drain the body so the connection is released; its contents are never logged.
      try {
        await res.arrayBuffer?.();
      } catch {
        /* ignore */
      }
      if (!res.ok) log.warn?.(`Email (${provider}) not sent: HTTP ${res.status}.`);
      return { ok: !!res.ok, status: res.status };
    } catch (err) {
      log.warn?.(`Email (${provider}) not sent: ${err?.name === 'TimeoutError' ? 'timed out' : err?.name || 'request failed'}.`);
      return { ok: false, status: 0, reason: 'network' };
    }
  }

  return { provider, enabled: provider !== 'none', notes: settings.notes, send };
}

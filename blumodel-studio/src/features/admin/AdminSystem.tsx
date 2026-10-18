/**
 * Admin > System: how the server is doing and how it is set up (GET /api/admin/system). Keys and
 * secrets are only ever "set" or "not set" here; the server never sends a value. They live in
 * blumodel.env on the server and are changed there by hand, then the server is restarted.
 */
import { timeAgo } from '../../store/useSession';
import { adminApi } from './api';
import type { SystemStatus } from './types';
import { Notice, Pill, Section, bytes, dateTime, duration, useLoad, yesNo } from './ui';
import UpdatesCard from './UpdatesCard';

const FAILURE_LABEL: Record<string, string> = {
  not_enabled: 'Stripe not on here (503)',
  signature: 'Bad signature',
  malformed: 'Malformed body',
  handler_error: 'Handler failed',
};

function PaymentsState({ p }: { p: SystemStatus['payments'] }) {
  if (p.provider === 'stripe') return <Pill tone={p.stripeMode === 'live' ? 'ok' : 'warn'}>Stripe {p.stripeMode ?? ''}</Pill>;
  if (p.provider === 'demo') return <Pill tone="warn">Demo (no real money)</Pill>;
  return <Pill tone="bad">Off</Pill>;
}

export default function AdminSystem() {
  const { data: s, setData, error, loading, reload } = useLoad(() => adminApi.system());
  if (error && !s) return <div className="auth-error">{error}</div>;
  if (!s) return <div className="screen-msg">Loading system status…</div>;

  const backupsStale = s.backups.enabled && (!s.backups.lastAt || s.generatedAt - s.backups.lastAt > 36 * 3_600_000);
  const lowDisk = s.disk && s.disk.totalBytes > 0 && s.disk.freeBytes / s.disk.totalBytes < 0.1;
  const p = s.payments;

  return (
    <div className="adm adm-system">
      <div className="adm-head">
        <div>
          <h1>System</h1>
          <p>Checked {timeAgo(s.generatedAt)}.</p>
        </div>
        <div className="adm-head-actions">
          <button type="button" className="btn small" onClick={() => void reload()} disabled={loading}>
            {loading ? 'Checking…' : 'Check again'}
          </button>
        </div>
      </div>
      <Notice>
        Keys and secrets are shown only as set or not set: this page never receives their values. They live in <code>blumodel.env</code> on the server and are edited there by hand, then the server is restarted.
      </Notice>

      <div className="adm-cols">
        <Section title="Server" id="adm-server">
          <dl className="adm-kv">
            <dt>Status</dt>
            <dd>{s.server.shuttingDown ? <Pill tone="warn">Shutting down</Pill> : <Pill tone="ok">Running</Pill>}</dd>
            <dt>Up for</dt>
            <dd>
              {duration(s.server.uptimeSec)} (since {dateTime(s.server.startedAt)})
            </dd>
            <dt>Version</dt>
            <dd className="mono">{s.server.version}</dd>
            <dt>Deployed commit</dt>
            <dd className="mono">{s.server.commit ? s.server.commit.slice(0, 12) : 'Not a deployed copy'}</dd>
            <dt>Deployed</dt>
            <dd>{dateTime(s.server.deployedAt)}</dd>
            <dt>Mode</dt>
            <dd>{s.server.production ? 'Production' : 'Development'}</dd>
            <dt>Address</dt>
            <dd>
              {s.server.publicUrl} {!s.server.httpsPublicUrl && <Pill tone="warn">not https</Pill>}
            </dd>
            <dt>Node</dt>
            <dd className="mono">{s.server.node}</dd>
          </dl>
        </Section>
        <Section title="Database and backups" id="adm-db">
          <dl className="adm-kv">
            <dt>Database</dt>
            <dd>{s.database.inMemory ? 'In memory (test server)' : `${bytes(s.database.sizeBytes)}${s.database.walBytes ? ` + ${bytes(s.database.walBytes)} WAL` : ''}`}</dd>
            <dt>Integrity at start</dt>
            <dd>{s.database.integrity === 'ok' ? <Pill tone="ok">OK</Pill> : s.database.integrity === 'problems' ? <Pill tone="bad">Problems</Pill> : <Pill>Not checked</Pill>}</dd>
            <dt>Daily backups</dt>
            <dd>{s.backups.enabled ? `${s.backups.count} kept (up to ${s.backups.keep})` : <Pill tone="warn">Off</Pill>}</dd>
            <dt>Last backup</dt>
            <dd>
              {s.backups.lastAt ? dateTime(s.backups.lastAt) : s.backups.enabled ? 'None yet' : '—'} {backupsStale && <Pill tone="warn">over a day old</Pill>}
            </dd>
            <dt>Disk free</dt>
            <dd>
              {s.disk ? `${bytes(s.disk.freeBytes)} of ${bytes(s.disk.totalBytes)}` : '—'} {lowDisk && <Pill tone="bad">under 10%</Pill>}
            </dd>
          </dl>
        </Section>
      </div>

      <UpdatesCard updates={s.updates} onChange={(updates) => setData({ ...s, updates })} />

      <Section title="Payments" id="adm-pay">
        <div className="adm-cols">
          <dl className="adm-kv">
            <dt>Taking payments</dt>
            <dd>
              <PaymentsState p={p} />
            </dd>
            <dt>Stripe secret key</dt>
            <dd>{yesNo(p.secretKeySet)}</dd>
            <dt>Webhook signing secret</dt>
            <dd>
              {yesNo(p.webhookSecretSet)} {p.webhookSecretSet && !p.webhookSecretWellFormed && <Pill tone="bad">not a whsec_ value</Pill>}
            </dd>
            <dt>Last webhook</dt>
            <dd>{p.lastWebhookAt ? `${dateTime(p.lastWebhookAt)} (${timeAgo(p.lastWebhookAt)})` : 'None received'}</dd>
            <dt>Webhooks, 30 days</dt>
            <dd className="mono">{p.webhooks30d}</dd>
            <dt>Failures, 24 hours</dt>
            <dd>{p.failures24h ? <Pill tone="bad">{p.failures24h}</Pill> : <Pill tone="ok">0</Pill>}</dd>
          </dl>
          <div className="adm-form">
            {p.notes.length > 0 && (
              <Notice tone={p.provider === 'stripe' ? 'info' : 'warn'}>
                {p.notes.map((n, i) => (
                  <div key={i}>{n}</div>
                ))}
              </Notice>
            )}
            <b>Recent webhook failures</b>
            {p.failures.length === 0 ? (
              <p className="empty-note">None recorded.</p>
            ) : (
              <ul className="adm-log">
                {p.failures.map((f, i) => (
                  <li key={i}>
                    <time>{dateTime(f.at)}</time>
                    <b>{FAILURE_LABEL[f.reason] ?? f.reason}</b>
                    <span>
                      HTTP {f.status}
                      {f.eventType ? ` · ${f.eventType}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Section>

      <div className="adm-cols">
        <Section title="Email" id="adm-email">
          <dl className="adm-kv">
            <dt>Sending email</dt>
            <dd>{s.email.configured ? <Pill tone="ok">{s.email.provider === 'resend' ? 'Resend' : 'Postmark'}</Pill> : <Pill tone="warn">No provider</Pill>}</dd>
            <dt>Provider key</dt>
            <dd>{yesNo(s.email.keySet)}</dd>
            <dt>EMAIL_FROM</dt>
            <dd>{yesNo(s.email.fromSet)}</dd>
          </dl>
          {!s.email.configured && <p className="adm-note">Without a provider, password resets go through Admin › Users › Create reset link.</p>}
        </Section>
        <Section title="Legal and support" id="adm-legal">
          <dl className="adm-kv">
            <dt>SUPPORT_EMAIL</dt>
            <dd>{yesNo(s.legal.supportEmailSet)}</dd>
            <dt>LEGAL_NAME</dt>
            <dd>{yesNo(s.legal.legalNameSet)}</dd>
            <dt>LEGAL_JURISDICTION</dt>
            <dd>{yesNo(s.legal.jurisdictionSet)}</dd>
            <dt>Photo-to-kitchen AI</dt>
            <dd>{yesNo(s.llm.configured, 'On', 'Off')}</dd>
          </dl>
        </Section>
      </div>

      <Section title="Recent server errors and warnings" id="adm-log">
        {!s.log.available ? (
          <p className="empty-note">The server isn’t writing its own log here (BLUMODEL_LOG_FILE is not set), so there is nothing to show.</p>
        ) : s.log.entries.length === 0 ? (
          <p className="empty-note">No errors or warnings in the latest log.</p>
        ) : (
          <ul className="adm-log">
            {s.log.entries.map((e, i) => (
              <li key={i}>
                <time>{dateTime(e.at)}</time>
                <Pill tone={e.level === 'error' ? 'bad' : 'warn'}>{e.level}</Pill>
                <code>{e.text}</code>
              </li>
            ))}
          </ul>
        )}
        <p className="adm-note" style={{ marginTop: 8 }}>
          Anything that looks like a key, token or password is replaced with [redacted] before it leaves the server.
        </p>
      </Section>
    </div>
  );
}

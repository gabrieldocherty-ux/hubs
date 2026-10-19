/**
 * Small pieces the admin panel's tabs share: loading state, stat cards, per-currency money, status
 * pills and the responsive table (a table at desktop width, one card per row on phones: every cell
 * carries its column name in `data-label`, which admin.css shows above the value on small screens).
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError } from '../../lib/api';
import { money } from '../../lib/money';
import type { ByCurrency } from './types';
import './admin.css';

export const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

/** Loads with `fn` on mount (and on `reload()`); keeps the last good value while reloading. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const reload = useCallback(async () => {
    const n = ++seq.current;
    setLoading(true);
    try {
      const d = await fn();
      if (n === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (err) {
      if (n === seq.current) setError(errorText(err, 'Could not load this.'));
    } finally {
      if (n === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, setData, error, loading, reload };
}

export const day = (ms: number | null | undefined) =>
  ms ? new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
/** The UTC calendar day a plan ends on, from its exclusive end (the start of the next UTC day). */
export const endDay = (exclusiveEnd: number | null | undefined) =>
  exclusiveEnd ? new Date(exclusiveEnd - 1).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—';
export const dateTime = (ms: number | null | undefined) =>
  ms ? new Date(ms).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';

export function bytes(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function duration(sec: number): string {
  const d = Math.floor(sec / 86_400);
  const h = Math.floor((sec % 86_400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d) return `${d} d ${h} h`;
  if (h) return `${h} h ${m} min`;
  return `${m} min`;
}

/** CAD first, then legacy currencies on their own line, each with its code. Never added together. */
export function MoneyLines({ by, empty = '$0 CAD', legacyLabel = 'legacy' }: { by: ByCurrency | undefined; empty?: string; legacyLabel?: string }) {
  const entries = Object.entries(by ?? {}).filter(([, v]) => (v ?? 0) !== 0);
  const cad = entries.find(([c]) => c === 'cad');
  const rest = entries.filter(([c]) => c !== 'cad');
  return (
    <>
      <b className="adm-big mono">{cad ? money(cad[1] ?? 0, 'cad') : empty}</b>
      {rest.map(([c, v]) => (
        <span key={c} className="adm-sub">
          + {money(v ?? 0, c)} <span className="adm-tag">{legacyLabel}</span>
        </span>
      ))}
    </>
  );
}

export function Stat({ title, children, tone }: { title: string; children: ReactNode; tone?: 'warn' | 'bad' }) {
  return (
    <section className={`adm-stat${tone ? ` ${tone}` : ''}`}>
      <span className="eyebrow">{title}</span>
      {children}
    </section>
  );
}

export type PillTone = 'ok' | 'warn' | 'bad' | 'info' | 'plain';

export function Pill({ tone = 'plain', children }: { tone?: PillTone; children: ReactNode }) {
  return <span className={`adm-pill ${tone}`}>{children}</span>;
}

export const yesNo = (v: boolean, yes = 'Set', no = 'Not set') => <Pill tone={v ? 'ok' : 'warn'}>{v ? yes : no}</Pill>;

export function Section({ title, children, actions, id }: { title: string; children: ReactNode; actions?: ReactNode; id?: string }) {
  return (
    <section className="adm-section" aria-labelledby={id}>
      <div className="adm-section-head">
        <h2 id={id}>{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

export interface Column<T> {
  label: string;
  cell: (row: T) => ReactNode;
  /** Shown first and larger in the phone card. */
  primary?: boolean;
  className?: string;
}

/** A table on wide screens; on phones each row becomes a card (admin.css). */
export function DataTable<T>({ rows, columns, rowKey, empty = 'Nothing here yet.', label }: { rows: T[]; columns: Column<T>[]; rowKey: (r: T) => string; empty?: string; label: string }) {
  if (!rows.length) return <p className="empty-note">{empty}</p>;
  return (
    <table className="adm-table" aria-label={label}>
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.label} scope="col">
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={rowKey(r)}>
            {columns.map((c) => (
              <td key={c.label} data-label={c.label} className={[c.primary ? 'primary' : '', c.className ?? ''].join(' ').trim() || undefined}>
                {c.cell(r)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'bad' | 'ok'; children: ReactNode }) {
  return (
    <div className={`adm-notice ${tone}`} role={tone === 'bad' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export const PLAN_LABEL: Record<string, string> = { free: 'Free', unlimited: 'Unlimited', contractor: 'Contractor' };

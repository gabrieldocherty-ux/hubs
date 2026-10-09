import type { ReactNode } from 'react';
import { AccountMenu } from '../../components/AccountMenu';
import { Logo } from '../../components/Icons';
import { hrefFor } from '../../lib/router';
import type { OrderStatus } from '../../types/platform';
import type { OrderEventWire } from './api';
import { dateTime, eventTitle, STATUS_LABEL, statusTone } from './model';

/** The page frame for `#/orders/*`: the app bar, a "Custom models" link and the account menu. */
export function OrdersShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="ord-page">
      <header className="home-bar">
        <a className="brand" href="#/">
          <Logo />
          <span className="wordmark">Mise</span>
        </a>
        <nav className="ord-nav" aria-label="Custom models">
          <a href={hrefFor({ name: 'orders', rest: '' })}>My orders</a>
          <a className="btn primary" href={hrefFor({ name: 'orders', rest: 'new' })}>
            Request a model
          </a>
        </nav>
        <AccountMenu />
      </header>
      <main className={wide ? 'ord-main ord-main--wide' : 'ord-main'}>{children}</main>
    </div>
  );
}

/** A status pill: the label always travels with the colour. */
export function StatusPill({ status, label }: { status: OrderStatus; label?: string }) {
  return <span className={`ord-pill ord-pill--${statusTone(status)}`}>{label ?? STATUS_LABEL[status]}</span>;
}

/** The banner every payment screen carries while the DEMO provider is active (PRODUCT_SPEC §7.4). */
export function DemoBanner({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? 'ord-demo ord-demo--compact' : 'ord-demo'} role="note">
      <b>Demo payments – no real money</b>
      <span>Nothing is charged and no card details are collected. Payments are simulated.</span>
    </div>
  );
}

/** The order's history, oldest first, with any note under its row. */
export function Timeline({ events }: { events: OrderEventWire[] }) {
  if (!events.length) return <p className="empty-note">Nothing has happened yet.</p>;
  return (
    <ol className="ord-timeline">
      {events.map((e) => (
        <li key={e.id} className={`ord-tl ord-tl--${e.type}`}>
          <span className="ord-tl-dot" aria-hidden />
          <div>
            <div className="ord-tl-head">
              <b>{eventTitle(e)}</b>
              <time dateTime={new Date(e.createdAt).toISOString()}>{dateTime(e.createdAt)}</time>
            </div>
            {e.note && <p className="ord-tl-note">{e.note}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

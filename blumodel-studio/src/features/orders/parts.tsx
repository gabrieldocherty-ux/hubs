import type { ReactNode } from 'react';
import { AccountMenu } from '../../components/AccountMenu';
import { Logo, Wordmark } from '../../components/Icons';
import { PaymentsSoon } from '../../components/PaymentNotice';
import type { PaymentsMode } from '../../lib/config';
import { hrefFor } from '../../lib/router';
import type { OrderStatus } from '../../types/platform';
import type { OrderEventWire } from './api';
import { dateTime, eventTitle, statusLabel, statusTone } from './model';

/**
 * The page frame for `#/orders/*` ("Make custom models"; the route keeps its old name): the app
 * bar and the account menu. Nothing sits beside the account menu: the account menu's "Make custom
 * models" opens the list, and the list and each order page carry their own New request buttons.
 */
export function OrdersShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="ord-page">
      <header className="home-bar">
        <a className="brand" href="#/">
          <Logo />
          <Wordmark />
        </a>
        <AccountMenu />
      </header>
      <main className={wide ? 'ord-main ord-main--wide' : 'ord-main'}>{children}</main>
    </div>
  );
}

/** A status pill: the label always travels with the colour. */
export function StatusPill({ status, label, pricing }: { status: OrderStatus; label?: string; pricing?: string }) {
  return <span className={`ord-pill ord-pill--${statusTone(status)}`}>{label ?? statusLabel({ status, pricing })}</span>;
}

/**
 * The note an orders screen carries for this server's payments: the DEMO banner, "orders open
 * soon" while payments aren't open, and nothing at all with real Stripe payments.
 */
export function OrdersPayNote({ payments }: { payments: PaymentsMode | null }) {
  if (payments === 'demo') return <DemoBanner compact />;
  if (payments === 'none')
    return (
      <PaymentsSoon compact title="Payments open soon">
        This order can’t be paid for yet. Designing, saving and sharing your kitchens are free and work today.
      </PaymentsSoon>
    );
  return null;
}

/**
 * For anyone not on the Contractor plan: custom 3D models come with it (3 a month, made by our
 * studio). A contractor whose plan lapsed is told their requests already sent are still delivered.
 */
export function PlanOnlyNote({ lapsed = false, terms }: { lapsed?: boolean; terms?: { perMonth: number } }) {
  const n = terms?.perMonth ?? 3;
  if (lapsed) {
    return (
      <div className="ord-plan-note" role="note">
        <b>Your Contractor plan has lapsed, so new requests are paused.</b>
        <span>
          Requests you already sent are still being made and delivered. Renew in <a href={hrefFor({ name: 'billing' })}>Billing</a> to get {n} custom models a month again.
        </span>
      </div>
    );
  }
  return (
    <div className="ord-plan-note" role="note">
      <b>Custom 3D models come with the Contractor plan.</b>
      <span>
        It includes {n} a month, made by our studio from your product’s name, UPC and a photo, and they land privately in your catalog. <a href={hrefFor({ name: 'pricing' })}>See the Contractor plan</a>
      </span>
    </div>
  );
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

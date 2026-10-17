import type { ReactNode } from 'react';
import { AccountMenu } from '../../components/AccountMenu';
import { Logo, Wordmark } from '../../components/Icons';
import { PaymentsSoon } from '../../components/PaymentNotice';
import type { PaymentsMode } from '../../lib/config';
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
 * For anyone without an active Contractor plan (docs/SHOWROOM_PIVOT.md §3: the plan and its
 * models are no longer sold): what they ordered before is still made and delivered, and nothing
 * new is offered. `terms` is kept for callers and no longer used.
 */
export function PlanOnlyNote({ lapsed = false }: { lapsed?: boolean; terms?: { perMonth: number } }) {
  return (
    <div className="ord-plan-note" role="note">
      <b>{lapsed ? 'New custom-model requests are closed.' : 'These are your earlier custom-model orders.'}</b>
      <span>{lapsed ? 'Requests you already sent are still being made and delivered. ' : ''}New custom models are no longer sold here. Your receipts stay below.</span>
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

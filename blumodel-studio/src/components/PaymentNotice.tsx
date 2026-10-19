import type { ReactNode } from 'react';
import type { PaymentsMode } from '../lib/config';

/**
 * The words every paying screen shares, so the three payment states read the same everywhere:
 * `demo` carries a labelled DEMO banner, `none` a friendly "opens soon", and `stripe` says
 * nothing about demos at all.
 */

/** The labelled banner on every payment screen while payments are the DEMO simulation. */
export function DemoBanner({ compact = false, children }: { compact?: boolean; children?: ReactNode }) {
  return (
    <div className={`pay-note pay-note--demo${compact ? ' pay-note--compact' : ''}`} role="note">
      <b className="pay-note-tag">DEMO</b>
      <span>{children ?? 'Demo payments: no real money moves and no card details are collected.'}</span>
    </div>
  );
}

/** Shown instead of a checkout while payments aren't open (`payments: 'none'`). */
export function PaymentsSoon({ title = 'Payments open soon', children, compact = false }: { title?: string; children?: ReactNode; compact?: boolean }) {
  return (
    <div className={`pay-note pay-note--soon${compact ? ' pay-note--compact' : ''}`} role="status">
      <b className="pay-note-title">{title}</b>
      <span>{children ?? 'You can’t buy anything here yet. Designing, saving and sharing your kitchens are free and work today.'}</span>
    </div>
  );
}

/** The banner for the current mode: DEMO, "opens soon", or nothing for real payments. */
export function PaymentModeNote({ payments, compact = false, soon }: { payments: PaymentsMode | null; compact?: boolean; soon?: ReactNode }) {
  if (payments === 'demo') return <DemoBanner compact={compact} />;
  if (payments === 'none') return <PaymentsSoon compact={compact}>{soon}</PaymentsSoon>;
  return null;
}

/** Under every Pay / Unlock / Subscribe button. The links open in a new tab, so a checkout in progress is kept. */
export function AgreeToPay({ className = '' }: { className?: string }) {
  return (
    <p className={`agree ${className}`}>
      By paying you agree to the <a href="#/terms" target="_blank" rel="noopener">Terms</a> and the <a href="#/refunds" target="_blank" rel="noopener">Refund policy</a>.
    </p>
  );
}

/** Under every Create account button. */
export function AgreeToSignUp({ className = '' }: { className?: string }) {
  return (
    <p className={`agree ${className}`}>
      By creating an account you agree to the <a href="#/terms" target="_blank" rel="noopener">Terms</a> and the <a href="#/privacy" target="_blank" rel="noopener">Privacy policy</a>.
    </p>
  );
}

/** The button label while payments aren't open. */
export const SOON_LABEL = 'Opens soon';

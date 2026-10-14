import { useLegal } from '../../lib/config';
import { useSession } from '../../store/useSession';

/**
 * The legal footer every public page carries: Terms, Privacy, Refunds and, once the operator has
 * published one, a Contact address. Small on purpose (it lives in the main chunk). Admins also
 * see when the operator's legal details haven't been set.
 */
export function LegalLinks({ className = '', newTab = false }: { className?: string; newTab?: boolean }) {
  const legal = useLegal();
  const tab = newTab ? { target: '_blank', rel: 'noopener' } : {};
  return (
    <nav className={`legal-links ${className}`} aria-label="Legal">
      <a href="#/terms" {...tab}>
        Terms
      </a>
      <a href="#/privacy" {...tab}>
        Privacy
      </a>
      <a href="#/refunds" {...tab}>
        Refunds
      </a>
      {legal.supportEmail && <a href={`mailto:${legal.supportEmail}`}>Contact</a>}
      <span className="legal-links-owner">© {new Date().getFullYear()} {legal.businessName ?? 'BluModel Studio'}</span>
      <LegalUnsetBadge />
    </nav>
  );
}

/** For admins only: the legal pages are using neutral wording because the details aren't set. */
export function LegalUnsetBadge() {
  const legal = useLegal();
  const admin = useSession((s) => s.user?.role === 'admin');
  if (!admin || legal.ready) return null;
  return (
    <span className="legal-unset" title="Set LEGAL_NAME, SUPPORT_EMAIL and LEGAL_JURISDICTION in the server's settings file. Until then the Terms, Privacy and Refund pages say “the operator of this site”. Only admins see this.">
      Legal details not set
    </span>
  );
}

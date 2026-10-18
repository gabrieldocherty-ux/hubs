import { useConfig, useLegal } from '../../lib/config';
import { useSession } from '../../store/useSession';

/**
 * The footer's © lines: on the sales site ours (LEGAL_NAME, else BluModel Studio); on a showroom the
 * company's for its brand. A showroom is white-label, so its legal footer names only the company;
 * our © for the software and the template is on the showroom landing's footer ("Virtual showroom by
 * BluModel Studio · software ©") and in the terms (section 19). `software` is that line, for it.
 */
export function copyrightLines(tenantName: string | null, businessName: string | null, year = new Date().getFullYear()): { owner: string; software: string | null } {
  const ours = businessName || 'BluModel Studio';
  if (!tenantName) return { owner: `© ${year} ${ours}`, software: null };
  const company = tenantName.replace(/\s*\((demo|sample)\)\s*$/i, '').trim() || tenantName;
  return { owner: `© ${year} ${company}`, software: `Showroom software © ${year} ${ours}` };
}

/**
 * The legal footer every public page carries: Terms, Privacy, Refunds and, once the operator has
 * published one, a Contact address. Small on purpose (it lives in the main chunk). Admins also
 * see when the operator's legal details haven't been set.
 */
export function LegalLinks({ className = '', newTab = false }: { className?: string; newTab?: boolean }) {
  const legal = useLegal();
  // On a showroom the footer is the company's: visitors never pay (no Refunds), and the © of its
  // brand is theirs; the software and the showroom template stay ours, so that © is said too.
  const tenant = useConfig((s) => s.config?.tenant ?? null);
  const lines = copyrightLines(tenant?.name ?? null, legal.businessName);
  const tab = newTab ? { target: '_blank', rel: 'noopener' } : {};
  return (
    <nav className={`legal-links ${className}`} aria-label="Legal">
      <a href="#/terms" {...tab}>
        Terms
      </a>
      <a href="#/privacy" {...tab}>
        Privacy
      </a>
      {!tenant && (
        <a href="#/refunds" {...tab}>
          Refunds
        </a>
      )}
      {!tenant && legal.supportEmail && <a href={`mailto:${legal.supportEmail}`}>Contact</a>}
      <span className="legal-links-owner">{lines.owner}</span>
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

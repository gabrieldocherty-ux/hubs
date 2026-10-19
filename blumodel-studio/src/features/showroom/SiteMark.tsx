import './shell.css';
import { useState } from 'react';
import { Logo, Wordmark } from '../../components/Icons';
import { useShowroom } from './useShowroom';
import { shortName, type PublicTenant } from './site';

/** The company's logo, or its initial on its colour when it has none (or the picture fails). */
export function CompanyLogo({ tenant, size = 30, className = '' }: { tenant: PublicTenant; size?: number; className?: string }) {
  const [broken, setBroken] = useState(false);
  const url = tenant.branding.logoUrl;
  if (url && !broken)
    return <img className={`site-logo ${className}`.trim()} src={url} alt="" width={size} height={size} style={{ width: size, height: size }} onError={() => setBroken(true)} />;
  return (
    <span className={`site-logo site-logo--initial ${className}`.trim()} style={{ width: size, height: size, fontSize: Math.round(size * 0.48) }} aria-hidden>
      {shortName(tenant).charAt(0).toUpperCase() || '·'}
    </span>
  );
}

/**
 * The mark at the top left of every visitor screen: the company's logo and name on its showroom,
 * BluModel Studio's own everywhere else. `compact` drops the name (the phone editor's bar).
 */
export function SiteMark({ compact = false, nameClass = '' }: { compact?: boolean; nameClass?: string }) {
  const t = useShowroom();
  if (!t)
    return (
      <>
        <Logo />
        {!compact && <Wordmark />}
      </>
    );
  return (
    <>
      <CompanyLogo tenant={t} />
      {!compact && <span className={`site-name ${nameClass}`.trim()}>{shortName(t)}</span>}
    </>
  );
}

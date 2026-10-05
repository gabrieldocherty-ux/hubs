import { useState, type FormEvent } from 'react';
import { ApiError } from '../../lib/api';
import { useDesignStore } from '../../store/useDesignStore';
import { proApi } from './api';
import { CompanyFields, draftToInput, PricingFields, type CompanyDraft } from './CompanyFields';
import { useWorkspace } from './ContractorRoot';

/** `#/pro/company`: branding, contact details, default markup and tax. */
export default function Company() {
  const { profile, readOnly, refresh } = useWorkspace();
  const toast = useDesignStore((s) => s.toast);
  const [draft, setDraft] = useState<CompanyDraft>({
    company: profile.company,
    phone: profile.phone,
    email: profile.email,
    website: profile.website,
    serviceArea: profile.serviceArea,
    defaultMarkupPct: profile.defaultMarkupPct,
    taxPct: profile.taxPct,
    logoFileId: profile.logoFileId,
    logoUrl: profile.logoUrl,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await proApi.saveProfile(draftToInput(draft));
      await refresh();
      toast('Company details saved.', 'ok');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="pro-company-form" onSubmit={save}>
      <div className="pro-head">
        <div>
          <span className="eyebrow">Company</span>
          <h1>What your clients see</h1>
          <p className="muted">Your name, logo and contact details go on every quote and share link (“Prepared by {draft.company || 'your company'}”).</p>
        </div>
      </div>
      <section className="pro-card">
        <CompanyFields draft={draft} onChange={setDraft} disabled={readOnly} />
      </section>
      <section className="pro-card">
        <span className="eyebrow">Pricing defaults</span>
        <PricingFields draft={draft} onChange={setDraft} disabled={readOnly} />
      </section>
      {error && <div className="auth-error">{error}</div>}
      {!readOnly && (
        <div className="modal-actions">
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </form>
  );
}

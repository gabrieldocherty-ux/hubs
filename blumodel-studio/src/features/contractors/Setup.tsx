import { useState, type FormEvent } from 'react';
import { AccountMenu } from '../../components/AccountMenu';
import { Logo, Wordmark } from '../../components/Icons';
import { ApiError } from '../../lib/api';
import { hrefFor, navigateHash } from '../../lib/router';
import { proApi } from './api';
import type { ContractorProfile } from '../../types/platform';
import { checkCompany, CompanyFields, companyErrorsFrom, draftToInput, emptyCompany, PricingFields, type CompanyDraft, type CompanyErrors } from './CompanyFields';

const STEPS = ['Company', 'Pricing', 'Your catalog'] as const;

/**
 * The three-step company setup after starting the Contractor plan (PLANS_AND_CONTRACTORS §4.1). The
 * business name and phone are required before step 2 (the server refuses a company without them).
 * With `existing`, a company saved before that rule with one of them missing, it is one card that
 * asks for them before the workspace opens.
 */
export default function Setup({ onDone, existing = null }: { onDone: () => Promise<void>; existing?: ContractorProfile | null }) {
  if (existing) return <CompleteCompany profile={existing} onDone={onDone} />;
  return <NewCompany onDone={onDone} />;
}

function NewCompany({ onDone }: { onDone: () => Promise<void> }) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<CompanyDraft>(emptyCompany);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<CompanyErrors>({});

  const edit = (d: CompanyDraft) => {
    setFieldErrors((f) => ({ company: d.company !== draft.company ? undefined : f.company, phone: d.phone !== draft.phone ? undefined : f.phone }));
    setDraft(d);
  };

  const next = (e: FormEvent) => {
    e.preventDefault();
    if (step === 0) {
      const checked = checkCompany(draft);
      setDraft(checked.draft);
      setFieldErrors(checked.errors);
      setError(null);
      if (checked.errors.company || checked.errors.phone) return;
    }
    setError(null);
    setStep((s) => Math.min(2, s + 1));
  };

  const finish = async (to: string) => {
    setBusy(true);
    setError(null);
    try {
      await proApi.saveProfile(draftToInput(draft));
      await onDone();
      navigateHash(to, true);
    } catch (e) {
      const fields = companyErrorsFrom(e);
      if (fields) setFieldErrors(fields);
      setError(fields ? null : e instanceof ApiError ? e.message : 'Could not save. Try again.');
      if (e instanceof ApiError && (e.body as { field?: string } | undefined)?.field && ['company', 'email', 'phone', 'website'].includes((e.body as { field: string }).field)) setStep(0);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pro pro-setup">
      <header className="home-bar">
        <a className="brand" href="#/">
          <Logo />
          <Wordmark />
        </a>
        <ol className="steps" aria-label="Setup steps">
          {STEPS.map((s, i) => (
            <li key={s}>
              <button type="button" className={i === step ? 'on' : i < step ? 'done' : ''} onClick={() => i < step && setStep(i)} aria-current={i === step ? 'step' : undefined} disabled={i > step}>
                <span className="mono">{i + 1}</span> {s}
              </button>
            </li>
          ))}
        </ol>
        <AccountMenu />
      </header>
      <main className="pro-setup-main">
        <form className="pro-setup-card" onSubmit={next}>
          <span className="eyebrow">Contractor setup · step {step + 1} of 3</span>
          {step === 0 && (
            <>
              <h1>Your company</h1>
              <p className="muted">This is what your clients see on quotes and share links: “Prepared by {draft.company.trim() || 'your company'}”. Your business name and phone are required.</p>
              <CompanyFields draft={draft} onChange={edit} errors={fieldErrors} />
            </>
          )}
          {step === 1 && (
            <>
              <h1>Pricing defaults</h1>
              <p className="muted">BluModel Studio prices every kitchen at your cost plus your markup. Clients only ever see the result.</p>
              <PricingFields draft={draft} onChange={setDraft} />
            </>
          )}
          {step === 2 && (
            <>
              <h1>Start your catalog</h1>
              <p className="muted">Add what you sell. You can do any of these later from My catalog.</p>
              <div className="pro-start">
                <button type="button" className="pro-start-card" onClick={() => finish(hrefFor({ name: 'pro', rest: 'catalog/new' }))} disabled={busy}>
                  <b>Quick add a product</b>
                  <span>Pick a type, widths, door style and finishes. BluModel Studio draws it at true size; no 3D model needed.</span>
                </button>
                <button type="button" className="pro-start-card" onClick={() => finish(`${hrefFor({ name: 'pro', rest: 'catalog/new' })}?model=1`)} disabled={busy}>
                  <b>Upload your own 3D model</b>
                  <span>A .glb file of a product you sell, checked for size and dimensions.</span>
                </button>
                <button type="button" className="pro-start-card" onClick={() => finish(hrefFor({ name: 'pro', rest: 'modelling' }))} disabled={busy}>
                  <b>Have BluModel Studio model it</b>
                  <span>Send photos and a spec sheet; we model a product or a whole line for you (paid per item).</span>
                </button>
                <button type="button" className="pro-start-card pro-start-skip" onClick={() => finish(hrefFor({ name: 'pro', rest: '' }))} disabled={busy}>
                  <b>Skip for now</b>
                  <span>Go to your workspace.</span>
                </button>
              </div>
            </>
          )}
          {error && <div className="auth-error">{error}</div>}
          <div className="modal-actions pro-setup-nav">
            {step > 0 && (
              <button type="button" className="btn" onClick={() => setStep((s) => s - 1)} disabled={busy}>
                Back
              </button>
            )}
            {step < 2 && (
              <button type="submit" className="btn primary">
                Continue
              </button>
            )}
          </div>
        </form>
      </main>
    </div>
  );
}

/** An existing company with no business name or phone: one card, then the workspace. */
function CompleteCompany({ profile, onDone }: { profile: ContractorProfile; onDone: () => Promise<void> }) {
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
  const [fieldErrors, setFieldErrors] = useState<CompanyErrors>({});

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const checked = checkCompany(draft);
    setDraft(checked.draft);
    setFieldErrors(checked.errors);
    setError(null);
    if (checked.errors.company || checked.errors.phone) return;
    setBusy(true);
    try {
      await proApi.saveProfile(draftToInput(checked.draft));
      await onDone();
    } catch (err) {
      const fields = companyErrorsFrom(err);
      if (fields) setFieldErrors(fields);
      else setError(err instanceof ApiError ? err.message : 'Could not save. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pro pro-setup">
      <header className="home-bar">
        <a className="brand" href="#/">
          <Logo />
          <Wordmark />
        </a>
        <AccountMenu />
      </header>
      <main className="pro-setup-main">
        <form className="pro-setup-card" onSubmit={save} noValidate>
          <span className="eyebrow">Contractor workspace</span>
          <h1>Finish your company details</h1>
          <p className="muted pro-complete-note">Clients see your business name and phone on every quote and share link, so the workspace needs both. Everything else you set up stays as it is.</p>
          <CompanyFields
            draft={draft}
            onChange={(d) => {
              setFieldErrors((f) => ({ company: d.company !== draft.company ? undefined : f.company, phone: d.phone !== draft.phone ? undefined : f.phone }));
              setDraft(d);
            }}
            errors={fieldErrors}
          />
          {error && <div className="auth-error">{error}</div>}
          <div className="modal-actions pro-setup-nav">
            <button type="submit" className="btn primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save and open the workspace'}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}

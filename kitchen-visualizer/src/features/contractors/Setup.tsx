import { useState, type FormEvent } from 'react';
import { AccountMenu } from '../../components/AccountMenu';
import { Logo } from '../../components/Icons';
import { ApiError } from '../../lib/api';
import { hrefFor, navigateHash } from '../../lib/router';
import { proApi } from './api';
import { CompanyFields, draftToInput, emptyCompany, PricingFields, type CompanyDraft } from './CompanyFields';

const STEPS = ['Company', 'Pricing', 'Your catalog'] as const;

/** The three-step company setup after starting the Contractor plan (PLANS_AND_CONTRACTORS §4.1). */
export default function Setup({ onDone }: { onDone: () => Promise<void> }) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<CompanyDraft>(emptyCompany);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const next = (e: FormEvent) => {
    e.preventDefault();
    if (step === 0 && !draft.company.trim()) return setError('Enter your company name.');
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
      setError(e instanceof ApiError ? e.message : 'Could not save. Try again.');
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
          <span className="wordmark">Mise</span>
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
              <p className="muted">This is what your clients see on quotes and share links: “Prepared by {draft.company.trim() || 'your company'}”.</p>
              <CompanyFields draft={draft} onChange={setDraft} />
            </>
          )}
          {step === 1 && (
            <>
              <h1>Pricing defaults</h1>
              <p className="muted">Mise prices every kitchen at your cost plus your markup. Clients only ever see the result.</p>
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
                  <span>Pick a type, widths, door style and finishes. Mise draws it at true size; no 3D model needed.</span>
                </button>
                <button type="button" className="pro-start-card" onClick={() => finish(`${hrefFor({ name: 'pro', rest: 'catalog/new' })}?model=1`)} disabled={busy}>
                  <b>Upload your own 3D model</b>
                  <span>A .glb file of a product you sell, checked for size and dimensions.</span>
                </button>
                <button type="button" className="pro-start-card" onClick={() => finish(hrefFor({ name: 'pro', rest: 'modelling' }))} disabled={busy}>
                  <b>Have Mise model it</b>
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

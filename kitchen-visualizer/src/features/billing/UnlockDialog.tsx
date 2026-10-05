import { useEffect, useState, type FormEvent } from 'react';
import { Dialog } from '../../components/Dialog';
import { Check, Lock } from '../../components/Icons';
import { api, ApiError } from '../../lib/api';
import { prepareDocForSave } from '../../lib/doc';
import { navigate } from '../../lib/router';
import { useDesignStore } from '../../store/useDesignStore';
import { useSession } from '../../store/useSession';
import type { ExportKind, Plan } from '../../types/platform';
import plansJson from '../../data/plans.json';
import { billingApi, dollars, goToCheckout } from './api';
import { closeUnlock, loadEntitlements, openUnlock, saveIntent, type UnlockRequest } from './entitlements';
import './billing.css';

const PLANS = plansJson as Plan[];
const plan = (id: Plan['id']) => PLANS.find((p) => p.id === id)!;

const WHAT: Record<ExportKind, string> = {
  plan_png: 'the floor plan',
  scene_png: 'the 3D image',
  csv: 'the shopping list',
  json: 'the project file',
  render: 'the studio render',
  quote: 'the quote',
};

/**
 * The Unlock dialog (PLANS_AND_CONTRACTORS §2): $5 for this kitchen, or $15/month for every
 * kitchen. Someone without an account (or designing on this device) first makes a free account,
 * and their draft is saved into it, so nothing is lost.
 */
export default function UnlockDialog({ request }: { request: UnlockRequest }) {
  const user = useSession((s) => s.user);
  const kitchenName = useDesignStore((s) => s.doc.name);
  const projectId = request.projectId;
  const [demo, setDemo] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    billingApi
      .plans()
      .then((r) => setDemo(r.demo))
      .catch(() => setDemo(false));
  }, []);

  const step: 'account' | 'save' | 'plans' = !user ? 'account' : !projectId ? 'save' : 'plans';

  /** Device drafts and share views become a kitchen in the account, then the dialog carries on for it. */
  const saveToAccount = async () => {
    setBusy('save');
    setError(null);
    try {
      const doc = useDesignStore.getState().doc;
      const { project } = await api.createProject(doc.name, '', prepareDocForSave(doc));
      // The request lives in a store, so the dialog carries on for the new kitchen after the
      // editor reopens it from the account.
      openUnlock({ ...request, projectId: project.id });
      navigate({ name: 'kitchen', id: project.id }, true);
      useDesignStore.getState().toast(`Saved “${project.name}” to your kitchens.`, 'ok');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save this kitchen. Try again.');
    } finally {
      setBusy(null);
    }
  };

  const buy = async (what: 'kitchen_unlock' | 'unlimited') => {
    if (!projectId) return;
    setBusy(what);
    setError(null);
    try {
      const returnTo = `#/k/${projectId}`;
      const res = await billingApi.checkout(what === 'kitchen_unlock' ? { kind: 'kitchen_unlock', projectId, returnTo } : { kind: 'subscription', plan: 'unlimited', returnTo });
      saveIntent({ projectId, kind: request.kind });
      closeUnlock();
      goToCheckout(res.url);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // Already entitled (another tab, or a plan): just export.
        await loadEntitlements(true);
        setError(e.message);
      } else setError(e instanceof ApiError ? e.message : 'Could not start the payment. Try again.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog title={step === 'plans' ? `Unlock “${kitchenName}”` : 'Exports are a paid feature'} onClose={closeUnlock} wide className="unlock">
      {demo && step === 'plans' && (
        <p className="demo-banner" role="note">
          <b>DEMO</b> Demo payments: no real money moves and no card details are collected.
        </p>
      )}
      {step === 'account' && <AccountStep why={WHAT[request.kind]} />}
      {step === 'save' && (
        <div className="unlock-save">
          <p>
            To export {WHAT[request.kind]}, save this design to your kitchens first. It stays exactly as it is, and you can keep working on it from any device.
          </p>
          <button className="btn primary big" onClick={saveToAccount} disabled={busy === 'save'} data-autofocus>
            {busy === 'save' ? 'Saving…' : 'Save to my kitchens and continue'}
          </button>
        </div>
      )}
      {step === 'plans' && (
        <>
          <p className="unlock-lede">
            <Lock width={15} height={15} /> Designing, saving and sharing stay free. To export {WHAT[request.kind]}, pick one:
          </p>
          <div className="unlock-cards">
            <PlanOption
              plan={plan('kitchen_unlock')}
              note="Every export for this kitchen, forever, including after you change it."
              cta={busy === 'kitchen_unlock' ? 'Starting…' : `Unlock this kitchen · ${dollars(plan('kitchen_unlock').priceCents)}`}
              onChoose={() => buy('kitchen_unlock')}
              disabled={!!busy}
              autoFocus
            />
            <PlanOption
              plan={plan('unlimited')}
              note="Exports on all your kitchens, no watermarks. Cancel anytime."
              cta={busy === 'unlimited' ? 'Starting…' : `Go Unlimited · ${dollars(plan('unlimited').priceCents)}/month`}
              onChoose={() => buy('unlimited')}
              disabled={!!busy}
              featured
            />
          </div>
          <a className="unlock-contractor" href="#/pro" onClick={() => closeUnlock()}>
            Are you a contractor? See the Contractor plan ({dollars(plan('contractor').priceCents)}/month) →
          </a>
        </>
      )}
      {error && <div className="auth-error unlock-error">{error}</div>}
    </Dialog>
  );
}

function PlanOption({ plan, note, cta, onChoose, disabled, featured = false, autoFocus = false }: { plan: Plan; note: string; cta: string; onChoose: () => void; disabled: boolean; featured?: boolean; autoFocus?: boolean }) {
  return (
    <section className={`plan-option${featured ? ' plan-option--featured' : ''}`} aria-label={plan.name}>
      <span className="eyebrow">{plan.interval ? 'Monthly' : 'One time'}</span>
      <h4>{plan.name}</h4>
      <div className="plan-price">
        <b>{dollars(plan.priceCents)}</b>
        <span>{plan.interval ? '/ month' : 'once, for this kitchen'}</span>
      </div>
      <p className="plan-note">{note}</p>
      <ul className="plan-bullets">
        {plan.bullets.map((b) => (
          <li key={b}>
            <Check width={14} height={14} /> {b}
          </li>
        ))}
      </ul>
      <button className={featured ? 'btn primary wide' : 'btn wide'} onClick={onChoose} disabled={disabled} {...(autoFocus ? { 'data-autofocus': true } : {})}>
        {cta}
      </button>
    </section>
  );
}

/** A free account in two fields, without leaving the kitchen. */
function AccountStep({ why }: { why: string }) {
  const [mode, setMode] = useState<'signup' | 'signin'>('signup');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = mode === 'signup' ? await api.signup(name.trim(), email.trim(), password) : await api.login(email.trim(), password);
      useSession.getState().setUser(user);
      await loadEntitlements(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="unlock-account" onSubmit={submit}>
      <p>
        To export {why}, first {mode === 'signup' ? 'create a free account' : 'sign in'}. This design comes with you, saved as a kitchen in your account.
      </p>
      {mode === 'signup' && (
        <label className="field">
          <span>Your name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required data-autofocus />
        </label>
      )}
      <label className="field">
        <span>Email</span>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required {...(mode === 'signin' ? { 'data-autofocus': true } : {})} />
      </label>
      <label className="field">
        <span>Password {mode === 'signup' && <em>· at least 8 characters</em>}</span>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} required minLength={mode === 'signup' ? 8 : undefined} />
      </label>
      {error && <div className="auth-error">{error}</div>}
      <div className="modal-actions">
        <button type="button" className="btn" onClick={() => setMode(mode === 'signup' ? 'signin' : 'signup')}>
          {mode === 'signup' ? 'I have an account' : 'Create an account instead'}
        </button>
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? 'One moment…' : mode === 'signup' ? 'Create free account' : 'Sign in'}
        </button>
      </div>
    </form>
  );
}

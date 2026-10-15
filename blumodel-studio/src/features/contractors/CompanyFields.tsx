import { useRef, useState } from 'react';
import { ApiError } from '../../lib/api';
import { normalizePhone } from '../../lib/phone';
import type { ContractorProfile } from '../../types/platform';
import { proApi, type ProfileInput } from './api';
import './company-fields.css';

export interface CompanyDraft extends Required<Omit<ProfileInput, 'logoFileId'>> {
  logoFileId: string | null;
  logoUrl: string | null;
}

export const emptyCompany = (): CompanyDraft => ({
  company: '',
  phone: '',
  email: '',
  website: '',
  serviceArea: '',
  defaultMarkupPct: 30,
  taxPct: 0,
  logoFileId: null,
  logoUrl: null,
});

/** The two fields a contractor must fill in (the server checks the same: contractors/service.mjs). */
export type CompanyErrors = { company?: string; phone?: string };

/**
 * Checks the business name and phone the way the server does. Returns the field errors (empty when
 * both are fine) and the draft with its phone written the one standard way.
 */
export function checkCompany(d: CompanyDraft): { errors: CompanyErrors; draft: CompanyDraft } {
  const errors: CompanyErrors = {};
  if (!d.company.trim()) errors.company = 'Enter your business name.';
  const p = normalizePhone(d.phone);
  if (!p.ok) errors.phone = p.reason;
  else if (!p.value) errors.phone = 'Enter a business phone number. Clients see it on your quotes.';
  return { errors, draft: p.ok && p.value ? { ...d, phone: p.value } : d };
}

/** A company saved before the name and phone were both required: the workspace asks for them first. */
export const needsCompanyDetails = (p: Pick<ContractorProfile, 'company' | 'phone'>) => !p.company.trim() || !p.phone.trim();

/** A server refusal that names one of the two required fields, as field errors. */
export function companyErrorsFrom(e: unknown): CompanyErrors | null {
  const field = e instanceof ApiError ? (e.body as { field?: string } | undefined)?.field : undefined;
  return field === 'company' || field === 'phone' ? { [field]: (e as ApiError).message } : null;
}

/** Company name, logo and contact details: what a client sees on shares and quotes. */
export function CompanyFields({ draft, onChange, disabled = false, errors = {} }: { draft: CompanyDraft; onChange: (d: CompanyDraft) => void; disabled?: boolean; errors?: CompanyErrors }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<CompanyDraft>) => onChange({ ...draft, ...patch });

  const pickLogo = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const { file: f } = await proApi.uploadImage(file);
      set({ logoFileId: f.id, logoUrl: f.url });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'That image didn’t upload.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="pro-fields">
      <label className="field">
        <span>
          Business name<em> · required</em>
        </span>
        <input
          value={draft.company}
          onChange={(e) => set({ company: e.target.value })}
          maxLength={80}
          required
          disabled={disabled}
          placeholder="Smith Kitchens"
          autoComplete="organization"
          aria-invalid={!!errors.company}
          aria-describedby={errors.company ? 'pro-company-error' : undefined}
          data-autofocus
        />
        {errors.company && (
          <small className="pro-field-error" id="pro-company-error">
            {errors.company}
          </small>
        )}
      </label>
      <div className="field">
        <span>Logo</span>
        <div className="pro-logo">
          <div className="pro-logo-box">{draft.logoUrl ? <img src={draft.logoUrl} alt="Your logo" /> : <span>No logo</span>}</div>
          <button type="button" className="btn" onClick={() => fileRef.current?.click()} disabled={disabled || uploading}>
            {uploading ? 'Uploading…' : draft.logoUrl ? 'Change logo' : 'Upload logo'}
          </button>
          {draft.logoUrl && (
            <button type="button" className="btn" onClick={() => set({ logoFileId: null, logoUrl: null })} disabled={disabled}>
              Remove
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void pickLogo(f);
              e.target.value = '';
            }}
          />
        </div>
        <em className="fine">PNG, JPEG or WebP. It appears on your quotes and share links.</em>
        {error && <div className="auth-error">{error}</div>}
      </div>
      <div className="pro-grid-2">
        <label className="field">
          <span>
            Business phone<em> · required</em>
          </span>
          <input
            value={draft.phone}
            onChange={(e) => set({ phone: e.target.value })}
            onBlur={() => {
              const p = normalizePhone(draft.phone);
              if (p.ok && p.value && p.value !== draft.phone) set({ phone: p.value });
            }}
            inputMode="tel"
            autoComplete="tel"
            placeholder="(905) 555-0142"
            required
            disabled={disabled}
            aria-invalid={!!errors.phone}
            aria-describedby={errors.phone ? 'pro-phone-error' : undefined}
          />
          {errors.phone && (
            <small className="pro-field-error" id="pro-phone-error">
              {errors.phone}
            </small>
          )}
        </label>
        <label className="field">
          <span>Email</span>
          <input type="email" value={draft.email} onChange={(e) => set({ email: e.target.value })} autoComplete="email" disabled={disabled} />
        </label>
        <label className="field">
          <span>Website</span>
          <input value={draft.website} onChange={(e) => set({ website: e.target.value })} placeholder="smithkitchens.com" disabled={disabled} />
        </label>
        <label className="field">
          <span>Service area</span>
          <input value={draft.serviceArea} onChange={(e) => set({ serviceArea: e.target.value })} placeholder="Greater Toronto" maxLength={120} disabled={disabled} />
        </label>
      </div>
    </div>
  );
}

/** Default markup and tax: how a cost becomes a client's price. */
export function PricingFields({ draft, onChange, disabled = false }: { draft: CompanyDraft; onChange: (d: CompanyDraft) => void; disabled?: boolean }) {
  const example = 1000;
  const sell = example * (1 + (Number(draft.defaultMarkupPct) || 0) / 100);
  return (
    <div className="pro-fields">
      <div className="pro-grid-2">
        <label className="field">
          <span>Default markup %</span>
          <input type="number" min={0} max={1000} step={0.5} value={draft.defaultMarkupPct} onChange={(e) => onChange({ ...draft, defaultMarkupPct: Number(e.target.value) })} disabled={disabled} />
        </label>
        <label className="field">
          <span>Sales tax % on quotes (optional)</span>
          <input type="number" min={0} max={30} step={0.05} value={draft.taxPct} onChange={(e) => onChange({ ...draft, taxPct: Number(e.target.value) })} disabled={disabled} />
        </label>
      </div>
      <p className="pro-example">
        A product that costs you <b>${example.toLocaleString()}</b> sells for <b>${sell.toLocaleString(undefined, { maximumFractionDigits: 2 })}</b>. Change it any time, and override it per brand, per line or per product in your price book.
      </p>
    </div>
  );
}

export function draftToInput(d: CompanyDraft): ProfileInput {
  return {
    company: d.company.trim(),
    phone: d.phone.trim(),
    email: d.email.trim(),
    website: d.website.trim(),
    serviceArea: d.serviceArea.trim(),
    defaultMarkupPct: Number(d.defaultMarkupPct) || 0,
    taxPct: Number(d.taxPct) || 0,
    logoFileId: d.logoFileId,
  };
}

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { ApiError } from '../../lib/api';
import { money } from '../../lib/format';
import { Close, Search } from '../../components/Icons';
import type { Product } from '../../types';
import { brandApi, type AdminBrand, type BrandKind } from './api';
import { needsDemoTag, PAGE_STATUS_LABEL, PAGE_STATUS_TONE, pageHash } from './logic';
import { NoteDialog } from './NoteDialog';
import './brands.css';

/**
 * `#/admin/brands` (BRAND_PAGE §9): every brand, contractor or partner, with status, live
 * products and a lead *count* (lead contents stay with the contractor). Suspend / Reinstate with a
 * note, Verify / Unverify, and partner brands (curated catalog content) created here.
 */
export default function AdminBrandsTab() {
  const [brands, setBrands] = useState<AdminBrand[] | null>(null);
  const [kind, setKind] = useState<BrandKind | 'all'>('all');
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [suspending, setSuspending] = useState<AdminBrand | null>(null);
  const [editing, setEditing] = useState<AdminBrand | 'new' | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setBrands((await brandApi.adminBrands()).brands);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load brands.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (b: AdminBrand, action: 'reinstate' | 'verify' | 'unverify') => {
    setBusy(`${b.id}:${action}`);
    setFlash(null);
    try {
      await brandApi.brandAction(b.id, action);
      setFlash(`${b.name}: ${action === 'reinstate' ? 'reinstated' : action === 'verify' ? 'verified' : 'no longer verified'}.`);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'That didn’t work.');
    } finally {
      setBusy(null);
    }
  };

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (brands ?? []).filter((b) => (kind === 'all' || b.kind === kind) && (!s || `${b.name} ${b.slug} ${b.owner?.email ?? ''}`.toLowerCase().includes(s)));
  }, [brands, kind, q]);

  if (error && !brands) return <div className="auth-error">{error}</div>;
  if (!brands) return <div className="screen-msg">Loading brands…</div>;

  const count = (k: BrandKind) => brands.filter((b) => b.kind === k).length;

  return (
    <div className="adm-brands">
      <div className="adm-head">
        <h1>Brands</h1>
        <button className="btn primary" onClick={() => setEditing('new')}>
          New partner brand
        </button>
      </div>
      <p className="muted adm-intro">
        Contractor brands are run by contractors from their workspace. Partner brands are curated catalog content with no login, managed here. Lead contents stay private to each contractor: only counts show here.
      </p>
      <div className="adm-toolbar">
        <div className="chips" role="group" aria-label="Kind">
          {(
            [
              ['all', `All ${brands.length}`],
              ['contractor', `Contractor ${count('contractor')}`],
              ['partner', `Partner ${count('partner')}`],
            ] as const
          ).map(([k, label]) => (
            <button key={k} className={kind === k ? 'chip on' : 'chip'} onClick={() => setKind(k)} aria-pressed={kind === k}>
              {label}
            </button>
          ))}
        </div>
        <label className="home-search adm-search">
          <Search />
          <input placeholder="Search name, address or owner" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search brands" />
        </label>
      </div>
      {flash && (
        <div className="auth-ok" role="status">
          {flash}
        </div>
      )}
      {error && <div className="auth-error">{error}</div>}
      {shown.length === 0 ? (
        <p className="empty-note">No brands match.</p>
      ) : (
        <ul className="adm-list">
          {shown.map((b) => (
            <li key={b.id} className="adm-brand">
              <div className="adm-brand-main">
                <div className="adm-brand-title">
                  <b>{b.name}</b>
                  <span className="tag">{b.kind === 'contractor' ? 'Contractor' : 'Partner'}</span>
                  <span className={`tag ${PAGE_STATUS_TONE[b.pageStatus]}`}>{PAGE_STATUS_LABEL[b.pageStatus]}</span>
                  {b.verified && <span className="tag ok">Verified</span>}
                  {needsDemoTag(b) && <span className="tag">Demo</span>}
                </div>
                <span className="muted">
                  <span className="mono">#/b/{b.slug}</span>
                  {b.owner ? ` · ${b.owner.name} (${b.owner.email})` : ''}
                  {b.kind === 'contractor' && b.planActive === false ? ' · plan lapsed' : ''}
                </span>
                {b.statusNote && <span className="adm-note">Note: {b.statusNote}</span>}
              </div>
              <dl className="adm-counts">
                <div>
                  <dt>Live products</dt>
                  <dd className="mono">{b.liveProducts}</dd>
                </div>
                <div>
                  <dt>Leads</dt>
                  <dd className="mono">{b.kind === 'contractor' ? b.leadCount : '—'}</dd>
                </div>
              </dl>
              <div className="adm-actions">
                {b.pageStatus === 'live' && (
                  <a className="btn" href={pageHash(b.slug)}>
                    View
                  </a>
                )}
                <button className="btn" onClick={() => setOpen(open === b.id ? null : b.id)} aria-expanded={open === b.id}>
                  Products
                </button>
                {b.kind === 'partner' && (
                  <button className="btn" onClick={() => setEditing(b)}>
                    Edit
                  </button>
                )}
                {b.verified ? (
                  <button className="btn" onClick={() => void act(b, 'unverify')} disabled={busy !== null}>
                    Unverify
                  </button>
                ) : (
                  <button className="btn" onClick={() => void act(b, 'verify')} disabled={busy !== null}>
                    Verify
                  </button>
                )}
                {b.status === 'suspended' && b.hiddenReason !== 'lapsed' ? (
                  <button className="btn" onClick={() => void act(b, 'reinstate')} disabled={busy !== null}>
                    Reinstate
                  </button>
                ) : (
                  b.status !== 'suspended' && (
                    <button className="btn brand-danger-ghost" onClick={() => setSuspending(b)} disabled={busy !== null}>
                      Suspend…
                    </button>
                  )
                )}
              </div>
              {open === b.id && <BrandProductsList brand={b} onChanged={load} />}
            </li>
          ))}
        </ul>
      )}

      {suspending && (
        <NoteDialog
          title={`Suspend ${suspending.name}`}
          intro="The page and its products are hidden at once. Kitchens that use them keep them. The brand sees this note."
          action="Suspend"
          danger
          onClose={() => setSuspending(null)}
          onSubmit={async (note) => {
            await brandApi.brandAction(suspending.id, 'suspend', note);
            setFlash(`${suspending.name} is suspended.`);
            await load();
          }}
        />
      )}
      {editing && (
        <PartnerDialog
          brand={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async (name) => {
            setFlash(editing === 'new' ? `${name} created. It’s live now; add its products under Products.` : `${name} saved.`);
            await load();
          }}
        />
      )}
    </div>
  );
}

function BrandProductsList({ brand, onChanged }: { brand: AdminBrand; onChanged: () => Promise<void> }) {
  const [items, setItems] = useState<(Product & { status: string; reviewNote: string })[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => {
    brandApi
      .brandProducts(brand.id)
      .then((r) => setItems(r.products))
      .catch(() => setItems([]));
  }, [brand.id]);
  useEffect(load, [load]);

  const act = async (id: string, action: 'unpublish' | 'restore') => {
    setBusy(id);
    try {
      await brandApi.productAction(id, action);
      load();
      await onChanged();
    } finally {
      setBusy(null);
    }
  };

  if (!items) return <p className="muted adm-products">Loading products…</p>;
  if (!items.length) return <p className="muted adm-products">No products.</p>;
  return (
    <div className="brand-table-wrap adm-products">
      <table className="brand-table">
        <thead>
          <tr>
            <th>Product</th>
            <th>Status</th>
            <th className="num">Public price</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((p) => (
            <tr key={p.id}>
              <td>{p.status === 'published' ? <a href={`#/p/${p.id}`}>{p.name}</a> : p.name}</td>
              <td>
                <span className={`tag ${p.status === 'published' ? 'ok' : p.status === 'submitted' ? 'warn' : p.status === 'rejected' ? 'bad' : ''}`}>{p.status}</span>
              </td>
              <td className="num mono">{p.price > 0 ? money(p.price) : 'on request'}</td>
              <td className="num">
                {p.status === 'archived' ? (
                  <button className="btn" onClick={() => void act(p.id, 'restore')} disabled={busy !== null}>
                    Restore
                  </button>
                ) : (
                  p.status === 'published' && (
                    <button className="btn" onClick={() => void act(p.id, 'unpublish')} disabled={busy !== null}>
                      Unpublish
                    </button>
                  )
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PartnerDialog({ brand, onClose, onSaved }: { brand: AdminBrand | null; onClose: () => void; onSaved: (name: string) => Promise<void> }) {
  const [name, setName] = useState(brand?.name ?? '');
  const [tagline, setTagline] = useState(brand?.tagline ?? '');
  const [about, setAbout] = useState(brand?.about ?? '');
  const [website, setWebsite] = useState(brand?.website ?? '');
  const [isDemo, setIsDemo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { name: name.trim(), tagline: tagline.trim(), about: about.trim(), website: website.trim() };
      if (brand) await brandApi.editPartner(brand.id, body);
      else await brandApi.createPartner({ ...body, isDemo });
      await onSaved(body.name);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save.');
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="partner-title">
        <header>
          <h3 id="partner-title">{brand ? `Edit ${brand.name}` : 'New partner brand'}</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <Close />
          </button>
        </header>
        <p className="dialog-copy">Curated catalog content with no login. It’s live as soon as it’s created; Verify adds the badge.</p>
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
        </label>
        <label className="field">
          <span>
            Tagline <em>· optional</em>
          </span>
          <input value={tagline} onChange={(e) => setTagline(e.target.value)} maxLength={80} />
        </label>
        <label className="field">
          <span>
            About <em>· optional</em>
          </span>
          <textarea className="brand-textarea" rows={3} value={about} onChange={(e) => setAbout(e.target.value)} maxLength={600} />
        </label>
        <label className="field">
          <span>
            Website <em>· optional</em>
          </span>
          <input value={website} onChange={(e) => setWebsite(e.target.value)} maxLength={300} placeholder="https://" />
        </label>
        {!brand && (
          <label className="pro-check">
            <input type="checkbox" checked={isDemo} onChange={(e) => setIsDemo(e.target.checked)} /> Demo content (labelled “Demo” everywhere)
          </label>
        )}
        {error && <div className="auth-error">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy || !name.trim()}>
            {busy ? 'Saving…' : brand ? 'Save' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}

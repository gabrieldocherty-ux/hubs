import { useEffect, useState } from 'react';
import { useDesignStore, useSelected } from '../store/useDesignStore';
import { useEstimate, useReport } from '../store/derived';
import { productCode, isOpening } from '../data/catalog';
import { finishList, finishPosition, resolveFinish } from '../lib/finish';
import { feetInches, inches, money } from '../lib/format';
import { flushWall } from '../lib/geometry';
import type { CheckLevel } from '../lib/checks';
import { ProductArt } from './ProductArt';
import { Alert, Check, Close, Copy, Download, Flip, Info, Lock, Plus, RotateCcw, RotateCw, Stop, Trash } from './Icons';
import { downloadText } from '../lib/exporters';
import { PLACEHOLDER_PRICES_NOTE, VISUALIZER_DISCLAIMER } from '../lib/csv';
import { makeId } from '../lib/id';
import { useSession } from '../store/useSession';
import { requestExport, useEntitlements } from '../features/billing';
import { ClientViewToggle, useKitchenPriceOf, usePriceBook, useShowCosts } from '../features/contractors';
import { priceFor } from '../data/catalog';
import type { EstimateExtra } from '../types';

function NumberField({ label, value, onCommit }: { label: string; value: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(value.toFixed(1).replace(/\.0$/, ''));
  useEffect(() => setText(value.toFixed(1).replace(/\.0$/, '')), [value]);
  return (
    <label className="num-field">
      <span>{label}</span>
      <input
        inputMode="decimal"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const v = parseFloat(text);
          if (Number.isFinite(v) && v !== value) onCommit(v);
          else setText(value.toFixed(1).replace(/\.0$/, ''));
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <em>″</em>
    </label>
  );
}

function Inspector() {
  const r = useSelected();
  const priceOf = useKitchenPriceOf();
  const surfaces = useDesignStore((s) => s.doc.surfaces);
  const room = useDesignStore((s) => s.doc.room);
  const report = useReport();
  const { rotate, remove, duplicate, setFinish, setWidth, toggleMirror, moveTo, applyCabinetFinishToAll } = useDesignStore.getState();
  if (!r) return null;
  const { product, item, w } = r;
  const finishes = finishList(product);
  const finish = resolveFinish(item, product, surfaces);
  const at = finishPosition(item, product);
  const missing = product.source === 'missing';
  const wall = flushWall(r, room);
  const issues = report.checks.filter((c) => c.itemIds.includes(item.id) && (c.level === 'bad' || c.level === 'warn'));
  // A contractor sees their sell price here, like their client will.
  const price = priceOf ? priceOf(product, w).sell : priceFor(product, w);
  const flippable = (product.kind === 'door' && product.variant === 'single') || product.kind === 'corner' || (product.kind === 'fridge' && product.variant === 'column');

  return (
    <div className="inspector">
      <div className="insp-hero">
        <ProductArt product={product} finish={finish} surfaces={surfaces} width={w} className="insp-art" />
      </div>
      <div className="insp-head">
        <div>
          <span className="eyebrow">{product.brand}</span>
          <h3>{product.name}</h3>
        </div>
        {!missing && <span className="code">{productCode(product, w)}</span>}
      </div>
      <p className="insp-blurb">{product.blurb}</p>
      <div className="insp-price">
        <span className="mono">{missing ? 'Price unavailable' : money(price)}</span>
        <span className="muted">{inches(w)} W × {inches(product.depthIn)} D × {inches(product.heightIn)} H{product.elevationIn > 0 ? ` · mounted at ${inches(product.elevationIn)}` : ''}</span>
      </div>

      {issues.length > 0 && (
        <div className="insp-issues">
          {issues.map((c) => (
            <div key={c.id} className={`issue ${c.level}`}>
              {c.level === 'bad' ? <Stop /> : <Alert />}
              <span>{c.title}</span>
            </div>
          ))}
        </div>
      )}

      {product.widthOptions && (
        <div className="insp-block">
          <span className="mini-label">Width</span>
          <div className="width-chips">
            {product.widthOptions.map((opt) => (
              <button key={opt} className={opt === w ? 'chip on mono' : 'chip mono'} onClick={() => setWidth(item.id, opt)}>
                {opt}″
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="insp-block">
        <span className="mini-label">Finish · {finish.name}</span>
        <div className="swatches">
          {finishes.map((f, i) => (
            <button
              key={f.id}
              className={i === at ? 'swatch on' : 'swatch'}
              style={f.material === 'panel' ? { background: 'repeating-linear-gradient(45deg,#cfc8bb 0 4px,#fff 4px 7px)' } : f.material === 'metal' ? { background: `linear-gradient(135deg, ${f.hex}, #fff9 45%, ${f.hex} 62%)` } : { background: f.hex }}
              title={f.name}
              aria-label={f.name}
              aria-pressed={i === at}
              onClick={() => setFinish(item.id, f.id)}
            />
          ))}
        </div>
        {product.finishes === 'cabinet' && (
          <button className="link-btn" onClick={() => applyCabinetFinishToAll(finishes[at].id)}>
            Use {finish.name} on every cabinet
          </button>
        )}
      </div>

      <div className="insp-block">
        <span className="mini-label">Position{wall ? ` · against the ${wall} wall` : ' · freestanding'}</span>
        <div className="pos-grid">
          <NumberField label="From west" value={isOpening(product) ? item.x : r.box.minX} onCommit={(v) => moveTo(item.id, isOpening(product) ? v : v + (item.x - r.box.minX), item.y)} />
          <NumberField label="From north" value={isOpening(product) ? item.y : r.box.minY} onCommit={(v) => moveTo(item.id, item.x, isOpening(product) ? v : v + (item.y - r.box.minY))} />
        </div>
      </div>

      <div className="insp-actions">
        <button onClick={() => rotate(item.id, -1)} title="Rotate left (Shift+R)"><RotateCcw /> </button>
        <button onClick={() => rotate(item.id, 1)} title="Rotate right (R)"><RotateCw /></button>
        {flippable && (
          <button onClick={() => toggleMirror(item.id)} title="Flip hinge side (F)"><Flip /></button>
        )}
        <button onClick={() => duplicate(item.id)} title="Duplicate (Ctrl+D)"><Copy /> Duplicate</button>
        <button className="danger" onClick={() => remove(item.id)} title="Delete (Del)"><Trash /> Remove</button>
      </div>
    </div>
  );
}

function Summary({ view, showPrices, compact }: { view: boolean; showPrices: boolean; compact: boolean }) {
  const room = useDesignStore((s) => s.doc.room);
  const items = useDesignStore((s) => s.doc.items);
  const est = useEstimate();
  const report = useReport();
  const setUI = useDesignStore((s) => s.setUI);
  const counts = { bad: 0, warn: 0, ok: 0, info: 0 } as Record<CheckLevel, number>;
  report.checks.forEach((c) => counts[c.level]++);
  return (
    <div className="summary">
      <div className="summary-card">
        <span className="eyebrow">This kitchen</span>
        <div className="summary-big">{feetInches(room.widthIn)} × {feetInches(room.lengthIn)}</div>
        <div className="summary-stats">
          <div><b className="mono">{Math.round((room.widthIn * room.lengthIn) / 144)}</b><span>sq ft</span></div>
          <div><b className="mono">{items.length}</b><span>pieces</span></div>
          {showPrices && <div><b className="mono">{money(est.total)}</b><span>estimated</span></div>}
        </div>
      </div>
      <button className="summary-checks" onClick={() => setUI({ rightTab: 'checks' })}>
        {counts.bad > 0 ? <Stop className="bad" /> : counts.warn > 0 ? <Alert className="warn" /> : <Check className="ok" />}
        <span>
          {counts.bad + counts.warn === 0
            ? 'Layout passes every design check'
            : `${counts.bad ? `${counts.bad} problem${counts.bad > 1 ? 's' : ''}` : ''}${counts.bad && counts.warn ? ' · ' : ''}${counts.warn ? `${counts.warn} suggestion${counts.warn > 1 ? 's' : ''}` : ''}`}
        </span>
      </button>
      {view ? (
        <div className="tips">
          <span className="mini-label">Shortcuts</span>
          <dl className="shortcuts">
            <dt><kbd>1–4</kbd></dt><dd>Plan · Split · 3D · Walls</dd>
          </dl>
        </div>
      ) : (
      <div className="tips">
        <span className="mini-label">Tips</span>
        {compact ? (
          <ul>
            <li>Tap <b>Add</b>, pick a product, then tap the plan where it goes. Or hold a product and drag it in.</li>
            <li>Drag a piece with one finger to move it. Backs snap to walls and edges click together.</li>
            <li>Tap a piece for Rotate, Duplicate and Delete; Details has width, finish and exact position.</li>
          </ul>
        ) : (
          <ul>
            <li>Drag products onto the plan or the 3D floor. Backs snap to walls and edges click together.</li>
            <li>Click a piece to rotate, duplicate or delete it, or to change its width, finish or exact position.</li>
            <li>Room & Finishes swaps counters, tile, floors and paint across the whole kitchen.</li>
          </ul>
        )}
        {!compact && (
          <>
            <span className="mini-label">Shortcuts</span>
            <dl className="shortcuts">
              <dt><kbd>R</kbd></dt><dd>Rotate</dd>
              <dt><kbd>⌫</kbd></dt><dd>Delete</dd>
              <dt><kbd>←↑→↓</kbd></dt><dd>Nudge 1″ (Shift 6″)</dd>
              <dt><kbd>⌘D</kbd></dt><dd>Duplicate</dd>
              <dt><kbd>⌘Z</kbd></dt><dd>Undo</dd>
              <dt><kbd>1–4</kbd></dt><dd>Plan · Split · 3D · Walls</dd>
            </dl>
          </>
        )}
      </div>
      )}
    </div>
  );
}

function ChecksPanel() {
  const report = useReport();
  const select = useDesignStore((s) => s.select);
  const selectedId = useDesignStore((s) => s.selectedId);
  const icon = (l: CheckLevel) => (l === 'bad' ? <Stop /> : l === 'warn' ? <Alert /> : l === 'ok' ? <Check /> : <Info />);
  return (
    <div className="checks">
      <p className="panel-intro">Measured against NKBA kitchen planning guidelines, live as you design.</p>
      {report.checks.map((c) => (
        <button key={c.id} className={`check ${c.level}${c.itemIds.includes(selectedId ?? '') ? ' focused' : ''}`} onClick={() => c.itemIds[0] && select(c.itemIds[0])} disabled={!c.itemIds.length}>
          <span className="check-icon">{icon(c.level)}</span>
          <span className="check-body">
            <b>{c.title}</b>
            <span>{c.detail}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

const pct = (n: number) => `${Math.round(n * 10) / 10}%`;

/** Labour and service lines a contractor adds to the estimate (installation, demolition, delivery…). */
function ExtrasEditor({ extras, showCosts }: { extras: EstimateExtra[]; showCosts: boolean }) {
  const setExtras = useDesignStore((s) => s.setExtras);
  const readOnly = useDesignStore((s) => s.readOnly);
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [cost, setCost] = useState('');
  if (readOnly) return null;
  const num = (v: string) => {
    const n = parseFloat(v.replace(/[$,\s]/g, ''));
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
  };
  const add = () => {
    const a = num(amount);
    if (!label.trim() || a === null) return;
    const c = num(cost);
    setExtras([...extras, { id: makeId(), label: label.trim(), amount: a, ...(showCosts && c !== null ? { cost: c } : {}) }]);
    setLabel('');
    setAmount('');
    setCost('');
  };
  return (
    <div className="est-extras">
      <span className="mini-label">Labour & services</span>
      {extras.map((x) => (
        <div key={x.id} className={showCosts ? 'est-extra-row' : 'est-extra-row no-cost'}>
          <span>{x.label}</span>
          <span className="mono">{money(x.amount)}</span>
          {showCosts && <span className="mono muted">{typeof x.cost === 'number' ? money(x.cost) : '—'}</span>}
          <button className="icon-btn" onClick={() => setExtras(extras.filter((e) => e.id !== x.id))} aria-label={`Remove ${x.label}`} title="Remove">
            <Close width={14} height={14} />
          </button>
        </div>
      ))}
      <div className={showCosts ? 'est-extra-row' : 'est-extra-row no-cost'}>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Installation, delivery…" aria-label="Labour or service" maxLength={80} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Price" aria-label="Price to the client" inputMode="decimal" onKeyDown={(e) => e.key === 'Enter' && add()} />
        {showCosts && <input value={cost} onChange={(e) => setCost(e.target.value)} placeholder="Your cost" aria-label="Your cost (private)" inputMode="decimal" onKeyDown={(e) => e.key === 'Enter' && add()} />}
        <button className="icon-btn" onClick={add} aria-label="Add this labour or service line" title="Add line" disabled={!label.trim() || num(amount) === null}>
          <Plus width={14} height={14} />
        </button>
      </div>
    </div>
  );
}

function EstimatePanel() {
  const est = useEstimate();
  const doc = useDesignStore((s) => s.doc);
  const projectId = useSession((s) => s.projectId);
  const { canExport } = useEntitlements(projectId);
  const { isContractor } = usePriceBook();
  const readOnly = useDesignStore((s) => s.readOnly);
  const showCosts = useShowCosts();
  const max = Math.max(1, ...est.groups.map((g) => g.total));
  const margin = est.costTotal !== null ? est.costedTotal - est.costTotal : null;
  return (
    <div className="estimate">
      <ClientViewToggle />
      <div className="est-total">
        <span className="eyebrow">Estimated total</span>
        <b className="mono">{money(est.total)}</b>
        <span className="muted">{doc.extras?.length ? 'Products, surfaces, hardware, labour and services. Excludes tax.' : 'Products, surfaces and hardware. Excludes labor, delivery and tax.'}</span>
        {showCosts && (
          <div className="est-costs" aria-label="Your costs (only you see these)">
            <div>
              <span>Your cost</span>
              <b className="mono">{est.costTotal !== null ? money(est.costTotal) : '—'}</b>
            </div>
            <div>
              <span>Margin</span>
              <b className="mono">{margin !== null ? money(margin) : '—'}</b>
            </div>
            <div>
              <span>Margin %</span>
              <b className="mono">{margin !== null && est.costedTotal > 0 ? pct((margin / est.costedTotal) * 100) : '—'}</b>
            </div>
          </div>
        )}
        {showCosts && est.uncosted > 0 && <span className="fine">{est.uncosted} line{est.uncosted === 1 ? '' : 's'} at list price: no cost entered. Margin covers the lines that have one.</span>}
      </div>
      <div className="est-bars">
        {est.groups.map((g) => (
          <div key={g.name} className="est-bar">
            <span>{g.name}</span>
            <i style={{ width: `${(g.total / max) * 100}%` }} />
            <b className="mono">{money(g.total)}</b>
          </div>
        ))}
      </div>
      <div className="est-lines">
        {est.lines.map((l) => (
          <div key={l.key} className="est-line">
            <div>
              <b>{l.label}</b>
              <span>{l.sub}</span>
              {showCosts &&
                (typeof l.unitCost === 'number' ? (
                  <span className="est-cost">
                    Cost {money(l.unitCost)}
                    {typeof l.markupPct === 'number' ? ` · markup ${pct(l.markupPct)}` : ''} · margin {money((l.unitPrice - l.unitCost) * l.qty)}
                  </span>
                ) : (
                  <span className="est-cost missing">No cost entered: at list price</span>
                ))}
            </div>
            <div className="mono">
              <span>{l.qty} {l.unit} × {money(l.unitPrice)}</span>
              <b>{money(l.total)}</b>
            </div>
          </div>
        ))}
      </div>
      {isContractor && !readOnly && <ExtrasEditor extras={doc.extras ?? []} showCosts={showCosts} />}
      <button
        className="btn wide"
        onClick={() =>
          void requestExport(projectId, 'csv', (file) => {
            if (file) downloadText(file.content, file.filename, file.contentType);
          })
        }
      >
        {canExport ? <Download /> : <Lock />} Download shopping list (CSV)
      </button>
      {est.hasBuiltin && <p className="fine">{PLACEHOLDER_PRICES_NOTE}</p>}
      <p className="fine">{VISUALIZER_DISCLAIMER}</p>
    </div>
  );
}

export function RightPanel({ mode = 'edit', showPrices = true, variant = 'panel' }: { mode?: 'edit' | 'view'; showPrices?: boolean; variant?: 'panel' | 'sheet' }) {
  const view = mode === 'view';
  /** The details column on a desktop; with variant="sheet" the same tabs inside the phone layout's Details sheet. */
  const compact = variant === 'sheet';
  const storedTab = useDesignStore((s) => s.ui.rightTab);
  // View mode shows the summary and (with prices) the estimate only: no inspector, no checks.
  const tab = view ? (storedTab === 'estimate' && showPrices ? 'estimate' : 'details') : storedTab;
  const setUI = useDesignStore((s) => s.setUI);
  const selectedId = useDesignStore((s) => s.selectedId);
  const report = useReport();
  const est = useEstimate();
  const issues = report.checks.filter((c) => c.level === 'bad' || c.level === 'warn').length;
  const hasBad = report.checks.some((c) => c.level === 'bad');
  return (
    <aside className={compact ? 'panel right-panel right-panel--sheet' : 'panel right-panel'}>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'details'} className={tab === 'details' ? 'on' : ''} onClick={() => setUI({ rightTab: 'details' })}>
          {selectedId && !view ? 'Selected' : 'Overview'}
        </button>
        {!view && (
          <button role="tab" aria-selected={tab === 'checks'} className={tab === 'checks' ? 'on' : ''} onClick={() => setUI({ rightTab: 'checks' })}>
            Checks {issues > 0 && <span className={hasBad ? 'badge bad' : 'badge warn'}>{issues}</span>}
          </button>
        )}
        {showPrices && (
          <button role="tab" aria-selected={tab === 'estimate'} className={tab === 'estimate' ? 'on' : ''} onClick={() => setUI({ rightTab: 'estimate' })}>
            Estimate <span className="badge plain mono">{est.total >= 1000 ? `$${Math.round(est.total / 1000)}k` : money(est.total)}</span>
          </button>
        )}
      </div>
      <div className="panel-scroll">
        {tab === 'details' && (selectedId && !view ? <Inspector /> : <Summary view={view} showPrices={showPrices} compact={compact} />)}
        {tab === 'checks' && <ChecksPanel />}
        {tab === 'estimate' && showPrices && <EstimatePanel />}
      </div>
    </aside>
  );
}

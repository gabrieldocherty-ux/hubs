import { useEffect, useState } from 'react';
import { useDesignStore, useSelected } from '../store/useDesignStore';
import { useEstimate, useReport } from '../store/derived';
import { productCode, priceFor, isOpening } from '../data/catalog';
import { finishList, resolveFinish } from '../lib/finish';
import { feetInches, inches, money } from '../lib/format';
import { flushWall } from '../lib/geometry';
import type { CheckLevel } from '../lib/checks';
import { ProductArt } from './ProductArt';
import { Alert, Check, Copy, Download, Flip, Info, RotateCcw, RotateCw, Stop, Trash } from './Icons';
import { downloadText, slug } from '../lib/exporters';
import { estimateCsv } from '../lib/csv';

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
  const surfaces = useDesignStore((s) => s.doc.surfaces);
  const room = useDesignStore((s) => s.doc.room);
  const report = useReport();
  const { rotate, remove, duplicate, setFinish, setWidth, toggleMirror, moveTo, applyCabinetFinishToAll } = useDesignStore.getState();
  if (!r) return null;
  const { product, item, w } = r;
  const finishes = finishList(product);
  const finish = resolveFinish(item, product, surfaces);
  const wall = flushWall(r, room);
  const issues = report.checks.filter((c) => c.itemIds.includes(item.id) && (c.level === 'bad' || c.level === 'warn'));
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
        <span className="code">{productCode(product, w)}</span>
      </div>
      <p className="insp-blurb">{product.blurb}</p>
      <div className="insp-price">
        <span className="mono">{money(priceFor(product, w))}</span>
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
              className={i === item.finishIndex ? 'swatch on' : 'swatch'}
              style={f.material === 'panel' ? { background: 'repeating-linear-gradient(45deg,#cfc8bb 0 4px,#fff 4px 7px)' } : f.material === 'metal' ? { background: `linear-gradient(135deg, ${f.hex}, #fff9 45%, ${f.hex} 62%)` } : { background: f.hex }}
              title={f.name}
              aria-label={f.name}
              aria-pressed={i === item.finishIndex}
              onClick={() => setFinish(item.id, i)}
            />
          ))}
        </div>
        {product.finishes === 'cabinet' && (
          <button className="link-btn" onClick={() => applyCabinetFinishToAll(item.finishIndex)}>
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

function Summary({ compact }: { compact: boolean }) {
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
          <div><b className="mono">{money(est.total)}</b><span>estimated</span></div>
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

function EstimatePanel() {
  const est = useEstimate();
  const doc = useDesignStore((s) => s.doc);
  const max = Math.max(1, ...est.groups.map((g) => g.total));
  return (
    <div className="estimate">
      <div className="est-total">
        <span className="eyebrow">Estimated total</span>
        <b className="mono">{money(est.total)}</b>
        <span className="muted">Products, surfaces and hardware. Excludes labor, delivery and tax.</span>
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
            </div>
            <div className="mono">
              <span>{l.qty} {l.unit} × {money(l.unitPrice)}</span>
              <b>{money(l.total)}</b>
            </div>
          </div>
        ))}
      </div>
      <button className="btn wide" onClick={() => downloadText(estimateCsv(doc, est), `${slug(doc.name)}-shopping-list.csv`, 'text/csv')}>
        <Download /> Download shopping list (CSV)
      </button>
      <p className="fine">Brand names and prices are placeholders for illustration.</p>
    </div>
  );
}

/** The details column on a desktop; with variant="sheet" the same tabs inside the phone layout's Details sheet. */
export function RightPanel({ variant = 'panel' }: { variant?: 'panel' | 'sheet' }) {
  const compact = variant === 'sheet';
  const tab = useDesignStore((s) => s.ui.rightTab);
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
          {selectedId ? 'Selected' : 'Overview'}
        </button>
        <button role="tab" aria-selected={tab === 'checks'} className={tab === 'checks' ? 'on' : ''} onClick={() => setUI({ rightTab: 'checks' })}>
          Checks {issues > 0 && <span className={hasBad ? 'badge bad' : 'badge warn'}>{issues}</span>}
        </button>
        <button role="tab" aria-selected={tab === 'estimate'} className={tab === 'estimate' ? 'on' : ''} onClick={() => setUI({ rightTab: 'estimate' })}>
          Estimate <span className="badge plain mono">{est.total >= 1000 ? `$${Math.round(est.total / 1000)}k` : money(est.total)}</span>
        </button>
      </div>
      <div className="panel-scroll">
        {tab === 'details' && (selectedId ? <Inspector /> : <Summary compact={compact} />)}
        {tab === 'checks' && <ChecksPanel />}
        {tab === 'estimate' && <EstimatePanel />}
      </div>
    </aside>
  );
}

import { Suspense, useCallback, useEffect, useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { api, ApiError, type Project } from '../../lib/api';
import { AgreeToPay } from '../../components/PaymentNotice';
import { usePayments } from '../../lib/config';
import { clearSessionId, markCheckout, paymentError, takeCheckoutReturn, type CheckoutReturn } from '../../lib/payments';
import { hrefFor, navigate, pageQuery } from '../../lib/router';
import { useCatalog } from '../../store/useCatalog';
import { productType } from '../../data/productTypes';
import type { Product } from '../../types';
import { ProductStage } from '../viewer';
import { goToCheckout, ordersApi, type OrderDetail, type OrderWire } from './api';
import { briefSize, isUnpaid, orderPrice, pricingLabel, relative, shortDate, sizeText } from './model';
import { money } from '../../lib/money';
import { formatUpc } from './upc';
import { OrdersPayNote, OrdersShell, StatusPill, Timeline } from './parts';

/**
 * `#/orders/:id`: the buyer's order page (PRODUCT_SPEC §7.5). Timeline, brief, private reference
 * photos and, once delivered, the model on the product stage with Add to a kitchen, Request
 * revision and Accept. Back from Stripe (`?session_id=` on the page URL) it syncs the payment
 * instead of waiting for the webhook, and says what happened at checkout (paid, still being
 * confirmed, or cancelled with nothing charged).
 */
export function OrderPage({ id }: { id: string }) {
  const [data, setData] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | 'cancel' | 'revision' | { add: Product }>(null);
  const [back, setBack] = useState<CheckoutReturn | null>(null);
  const payments = usePayments();
  const soon = payments === 'none';

  useEffect(() => {
    let live = true;
    (async () => {
      const ret = takeCheckoutReturn(hrefFor({ name: 'orders', rest: id }));
      const sessionId = ret?.sessionId ?? pageQuery().get('session_id');
      let d: OrderDetail;
      if (sessionId) {
        d = await ordersApi.get(id, { sessionId });
        // Keep the hash, drop Stripe's query so a reload doesn't sync again.
        clearSessionId();
      } else d = await ordersApi.get(id);
      if (!live) return;
      setData(d);
      if (ret) setBack(ret);
    })().catch((e) => live && setError(e instanceof ApiError ? e.message : 'Could not load this request.'));
    return () => {
      live = false;
    };
  }, [id]);

  const run = useCallback(
    async (key: string, fn: () => Promise<OrderDetail>) => {
      setBusy(key);
      setActionError(null);
      try {
        setData(await fn());
        setDialog(null);
        // Delivered models are private catalog products: reload so the editor can place them.
        if (key === 'accept') void useCatalog.getState().load(true);
      } catch (e) {
        setActionError(e instanceof ApiError ? e.message : 'That didn’t work. Try again.');
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const pay = async () => {
    setBusy('pay');
    setActionError(null);
    try {
      const { url } = await ordersApi.checkout(id);
      markCheckout('order', hrefFor({ name: 'orders', rest: id }));
      goToCheckout(url);
    } catch (e) {
      setActionError(paymentError(e));
      setBusy(null);
    }
  };

  if (error)
    return (
      <OrdersShell>
        <div className="screen-msg">
          <p>{error}</p>
          <a className="btn" href={hrefFor({ name: 'orders', rest: '' })}>
            Back to my custom models
          </a>
        </div>
      </OrdersShell>
    );
  if (!data)
    return (
      <OrdersShell>
        <div className="ord-loading">Loading the request…</div>
      </OrdersShell>
    );

  const o = data.order;
  /** Included in the Contractor plan: nothing was or will be paid. */
  const plan = o.pricing === 'plan';
  const unpaid = !plan && isUnpaid(o.status);
  /** A price in the order's own currency ("$279 USD" for an order from before 2026-10-15). */
  const price = (cents: number) => money(cents, o.currency);
  const roundsLeft = Math.max(0, o.revisionsAllowed - o.revisionsUsed);
  const deliverables = data.deliverables;
  // A demo-provider order says so once it's paid (nothing was charged), or while the demo is what pays it.
  const demoOrder = o.provider === 'demo' && (!unpaid || payments === 'demo');

  return (
    <OrdersShell>
      <a className="ord-back" href={hrefFor({ name: 'orders', rest: '' })}>
        ← Make custom models
      </a>
      <div className="ord-head">
        <div>
          <span className="eyebrow">
            {pricingLabel(o)}
            {o.items.length > 1 ? ` · ${o.items.length} products` : ''} · {o.target === 'brand' ? `for ${o.brandName ?? 'your brand'}` : o.target === 'contractor' ? 'for My catalog' : 'private to you'}
          </span>
          <h1>{o.title}</h1>
          <div className="ord-head-meta">
            <StatusPill status={o.status} pricing={o.pricing} />
            <span className={plan ? 'ord-included' : 'mono'}>{orderPrice(o)}</span>
            {demoOrder && <span className="ord-tag">Demo payment</span>}
            <span className="muted">Requested {shortDate(o.createdAt)}</span>
          </div>
        </div>
      </div>
      {unpaid && <OrdersPayNote payments={payments} />}
      {back && <CheckoutNote back={back} unpaid={unpaid} />}

      <section className="ord-card ord-status-card" aria-label="What happens next">
        <StatusMessage order={o} roundsLeft={roundsLeft} />
        {actionError && (
          <div className="auth-error" role="alert">
            {actionError}
          </div>
        )}
        <div className="ord-actions">
          {unpaid && (
            <>
              <button className="btn primary big" onClick={pay} disabled={!!busy || soon} title={soon ? 'Payments aren’t open yet' : undefined}>
                {soon ? 'Payments open soon' : busy === 'pay' ? 'Starting checkout…' : `Pay ${price(o.amountCents)}${payments === 'demo' ? ' (demo)' : ''}`}
              </button>
              <button className="btn big" onClick={() => setDialog('cancel')} disabled={!!busy}>
                Cancel request
              </button>
            </>
          )}
          {plan && o.cancellable && (
            <button className="btn big" onClick={() => setDialog('cancel')} disabled={!!busy}>
              Withdraw request
            </button>
          )}
          {o.status === 'delivered' && (
            <>
              <button className="btn primary big" onClick={() => void run('accept', () => ordersApi.accept(id))} disabled={!!busy}>
                {busy === 'accept' ? 'Accepting…' : 'Accept the model'}
              </button>
              <button className="btn big" onClick={() => setDialog('revision')} disabled={!!busy || roundsLeft === 0} title={roundsLeft === 0 ? 'Both revision rounds have been used.' : undefined}>
                Request revision ({roundsLeft} left)
              </button>
            </>
          )}
          {(o.status === 'expired' || o.status === 'cancelled') && (
            <a className="btn big" href={hrefFor({ name: 'orders', rest: 'new' })}>
              Start a new request
            </a>
          )}
        </div>
        {unpaid && !soon && <AgreeToPay />}
      </section>

      {deliverables.length > 0 && (
        <section className="ord-section" aria-labelledby="ord-deliv">
          <h2 id="ord-deliv">{deliverables.length > 1 ? 'Your models' : 'Your model'}</h2>
          <div className="ord-deliverables">
            {deliverables.map((p) => (
              <article key={p.id} className="ord-card ord-deliverable">
                <div className="ord-stage">
                  <Suspense fallback={<div className="ord-stage-wait">Loading the model…</div>}>
                    <ProductStage product={p} height={320} showDims />
                  </Suspense>
                </div>
                <div className="ord-deliverable-foot">
                  <div>
                    <b>{p.name}</b>
                    <span className="muted">
                      {' '}
                      · {sizeText(p.widthIn, p.depthIn, p.heightIn)}
                    </span>
                  </div>
                  {o.target === 'brand' ? (
                    <a className="btn" href={hrefFor({ name: 'pro', rest: 'brand/products' })}>
                      Open in my brand
                    </a>
                  ) : o.status !== 'refunded' ? (
                    <button className="btn" onClick={() => setDialog({ add: p })}>
                      Add to a kitchen
                    </button>
                  ) : null}
                </div>
                {o.target === 'brand' && <p className="fine">A draft in your brand’s products. Submit it for review when you’re happy with it.</p>}
                {o.target === 'contractor' && <p className="fine">In My catalog, private to your company. Set its cost and markup in the price book.</p>}
              </article>
            ))}
          </div>
        </section>
      )}

      <div className="ord-columns">
        <section className="ord-section" aria-labelledby="ord-brief">
          <h2 id="ord-brief">The brief</h2>
          {o.items.map((it) => {
            const t = productType(it.brief.productTypeId);
            return (
              <div key={it.idx} className="ord-card ord-brief">
                <div className="ord-brief-head">
                  <b>
                    {o.items.length > 1 ? `${it.idx + 1}. ` : ''}
                    {it.brief.name}
                  </b>
                  {/* Included in the plan; a pack's price was per pack (on the receipt); an older order priced each product. */}
                  {plan ? (
                    <span className="ord-pack-badge">Included</span>
                  ) : o.pricing === 'pack' ? (
                    <span className="ord-pack-badge">{o.packs > 1 ? `Pack ${it.pack ?? 1}` : 'Model pack'}</span>
                  ) : (
                    <span className="mono">{price(it.amountCents)}</span>
                  )}
                </div>
                <dl className="ord-dl">
                  <div>
                    <dt>Type</dt>
                    <dd>{t?.label ?? it.brief.productTypeId}</dd>
                  </div>
                  {it.brief.brand && (
                    <div>
                      <dt>Brand</dt>
                      <dd>{it.brief.brand}</dd>
                    </div>
                  )}
                  {(it.brief.upc || it.brief.barcodeFileId) && (
                    <div>
                      <dt>UPC</dt>
                      <dd className={it.brief.upc ? 'mono' : undefined}>{it.brief.upc ? formatUpc(it.brief.upc) : 'From the barcode photo'}</dd>
                    </div>
                  )}
                  <div>
                    <dt>Size</dt>
                    <dd>{briefSize(it.brief)}</dd>
                  </div>
                  <div>
                    <dt>{plan || o.pricing === 'pack' ? 'Includes' : 'Tier'}</dt>
                    <dd>
                      {plan || o.pricing === 'pack'
                        ? `Up to ${o.finishesPerModel ?? 3} finishes, ${o.revisionsAllowed} revision rounds`
                        : `${pricingLabel({ tier: it.tier })}${it.extraFinishes ? ` + ${it.extraFinishes} extra finish${it.extraFinishes === 1 ? '' : 'es'}` : ''}`}
                      {o.extras.rush ? ' · rush' : ''}
                    </dd>
                  </div>
                  {o.items.length > 1 && (
                    <div>
                      <dt>Model</dt>
                      <dd>{it.deliverableProductId ? `Delivered ${shortDate(it.deliveredAt)}` : 'Not delivered yet'}</dd>
                    </div>
                  )}
                </dl>
                {it.brief.notes && <p className="ord-notes">{it.brief.notes}</p>}
              </div>
            );
          })}
          {data.references.length > 0 && (
            <>
              <h3 className="mini-label">Reference photos (private)</h3>
              <ul className="ord-thumbs ord-thumbs--static">
                {data.references.map((f) => (
                  <li key={f.id}>
                    <a href={f.url} target="_blank" rel="noreferrer" aria-label={`Open ${f.originalName || 'reference photo'}`}>
                      <img src={f.url} alt={f.originalName || 'Reference photo'} />
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}
          {plan ? (
            <>
              <h3 className="mini-label">Your plan</h3>
              <ul className="ord-lines">
                {o.quote.lines.map((l, i) => (
                  <li key={i}>
                    <span>{l.label}</span>
                    <span className="ord-included">Included</span>
                  </li>
                ))}
              </ul>
              <p className="fine">
                Nothing to pay: {o.items.length === 1 ? 'this model came' : 'these models came'} from your Contractor plan’s monthly allowance
                {o.planPeriod ? ` (${shortDate(o.planPeriod.start)} to ${shortDate(o.planPeriod.end - 1)})` : ''}.
              </p>
            </>
          ) : (
            <>
              <h3 className="mini-label">Receipt</h3>
              <ul className="ord-lines">
                {o.quote.lines.map((l, i) => (
                  <li key={i}>
                    <span>{l.label}</span>
                    <span className="mono">{price(l.amountCents)}</span>
                  </li>
                ))}
              </ul>
              <div className="ord-total">
                <span>Total{demoOrder ? ' (demo, nothing charged)' : ''}</span>
                <b className="mono">{price(o.amountCents)}</b>
              </div>
            </>
          )}
        </section>

        <section className="ord-section" aria-labelledby="ord-tl">
          <h2 id="ord-tl">Timeline</h2>
          <Timeline events={data.events} />
        </section>
      </div>

      {dialog === 'cancel' && (
        <Dialog title={plan ? 'Withdraw this request?' : 'Cancel this request?'} onClose={() => setDialog(null)}>
          <p className="dialog-copy">
            {plan
              ? `The studio hasn’t started on it, so ${o.items.length === 1 ? 'its model goes' : `its ${o.items.length} models go`} back to this month’s allowance.`
              : 'It hasn’t been paid, so nothing is charged. You can start a new request any time.'}
          </p>
          <div className="modal-actions">
            <button className="btn" onClick={() => setDialog(null)} data-autofocus>
              Keep it
            </button>
            <button className="btn primary" onClick={() => void run('cancel', () => ordersApi.cancel(id))} disabled={busy === 'cancel'}>
              {busy === 'cancel' ? (plan ? 'Withdrawing…' : 'Cancelling…') : plan ? 'Withdraw request' : 'Cancel request'}
            </button>
          </div>
        </Dialog>
      )}
      {dialog === 'revision' && <RevisionDialog roundsLeft={roundsLeft} busy={busy === 'revision'} error={actionError} onClose={() => setDialog(null)} onSend={(note) => void run('revision', () => ordersApi.revision(id, note))} />}
      {dialog && typeof dialog === 'object' && <AddToKitchenDialog product={dialog.add} onClose={() => setDialog(null)} />}
    </OrdersShell>
  );
}

/** What happened at checkout, said once on the way back to the order. */
function CheckoutNote({ back, unpaid }: { back: CheckoutReturn; unpaid: boolean }) {
  if (!unpaid)
    return (
      <div className="auth-ok ord-return" role="status">
        Payment received. The studio has your request and starts on it next.
      </div>
    );
  if (back.outcome === 'cancel')
    return (
      <div className="auth-note ord-return" role="status">
        Checkout cancelled. Nothing was charged; your request is saved, so you can pay when you’re ready.
      </div>
    );
  return (
    <div className="auth-note ord-return" role="status">
      Payment received. We’re still confirming it with the payment provider: reload this page in a minute.
    </div>
  );
}

function StatusMessage({ order: o, roundsLeft }: { order: OrderWire; roundsLeft: number }) {
  switch (o.status) {
    case 'draft':
      return <p>Your request is saved. Pay to send it to the studio{o.expiresAt ? `; it expires ${relative(o.expiresAt)} if unpaid` : ''}.</p>;
    case 'pending_payment':
      return <p>Waiting for payment{o.expiresAt ? `. The request expires ${relative(o.expiresAt)} if it isn’t paid` : ''}.</p>;
    case 'payment_failed':
      return <p>The payment was declined and nothing was charged. Try again{o.expiresAt ? ` before it expires ${relative(o.expiresAt)}` : ''}.</p>;
    case 'paid':
      if (o.pricing === 'plan')
        return <p>Sent. Your request is in the studio queue{o.dueAt ? `, due by ${shortDate(o.dueAt)}` : ''}. You can withdraw it until the studio starts.</p>;
      return <p>Paid. Your request is in the studio queue{o.dueAt ? `, due by ${shortDate(o.dueAt)}` : ''}.</p>;
    case 'in_progress':
      return <p>The studio is modelling it{o.dueAt ? `, due by ${shortDate(o.dueAt)}` : ''}. You’ll see it here as soon as it’s delivered.</p>;
    case 'revision_requested':
      return <p>Revision requested. The studio will deliver an updated model here; your kitchens keep the current one until then.</p>;
    case 'delivered':
      return (
        <p>
          Delivered. Look it over, place it in a kitchen, then accept it, or ask for changes ({roundsLeft} revision round{roundsLeft === 1 ? '' : 's'} left).
        </p>
      );
    case 'completed':
      return <p>Completed. The model is yours{o.target === 'brand' ? ' as a draft in your brand' : o.target === 'contractor' ? ' in My catalog' : ' in your private catalog'}.</p>;
    case 'refunded':
      return <p>Refunded{o.refundedAt ? ` on ${shortDate(o.refundedAt)}` : ''}. Kitchens that already use the model keep it, but it’s no longer in your catalog.</p>;
    case 'cancelled':
      return <p>{o.pricing === 'plan' ? 'Cancelled before work started. Its models went back to that month’s allowance.' : 'Cancelled. Nothing was charged.'}</p>;
    case 'expired':
      return <p>This request expired before it was paid. Nothing was charged.</p>;
  }
}

function RevisionDialog({ roundsLeft, busy, error, onClose, onSend }: { roundsLeft: number; busy: boolean; error: string | null; onClose: () => void; onSend: (note: string) => void }) {
  const [note, setNote] = useState('');
  return (
    <Dialog title="Request a revision" onClose={onClose}>
      <p className="dialog-copy">
        Tell the studio what to change. You have {roundsLeft} round{roundsLeft === 1 ? '' : 's'} left.
      </p>
      <label className="field">
        <span>What should change?</span>
        <textarea className="ord-textarea" rows={5} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} data-autofocus />
      </label>
      {error && <div className="auth-error">{error}</div>}
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" disabled={busy || !note.trim()} onClick={() => onSend(note.trim())}>
          {busy ? 'Sending…' : 'Send to the studio'}
        </button>
      </div>
    </Dialog>
  );
}

function AddToKitchenDialog({ product, onClose }: { product: Product; onClose: () => void }) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .listProjects()
      .then((r) => setProjects([...r.projects].sort((a, b) => b.updatedAt - a.updatedAt)))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load your kitchens.'));
  }, []);
  const add = (projectId: string) => {
    // The editor looks the product up when the kitchen opens; register it so it's there at once.
    useCatalog.getState().register([product]);
    navigate({ name: 'kitchen', id: projectId, add: product.id });
  };
  return (
    <Dialog title={`Add ${product.name} to a kitchen`} onClose={onClose}>
      {error && <div className="auth-error">{error}</div>}
      {!projects && !error && <p className="muted">Loading your kitchens…</p>}
      {projects && projects.length === 0 && <p className="dialog-copy">You don’t have a saved kitchen yet. Start one; the model is in your catalog there, or come back here to add it.</p>}
      {projects && projects.length > 0 && (
        <ul className="ord-kitchens">
          {projects.map((p) => (
            <li key={p.id}>
              <button className="ord-kitchen" onClick={() => add(p.id)}>
                <b>{p.name || 'Untitled kitchen'}</b>
                <span className="muted">{p.client ? `${p.client} · ` : ''}edited {shortDate(p.updatedAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="modal-actions">
        <a className="btn" href={hrefFor({ name: 'new' })}>
          New kitchen
        </a>
        <button className="btn" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}

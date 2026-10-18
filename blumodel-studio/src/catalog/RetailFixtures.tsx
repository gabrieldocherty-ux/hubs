/**
 * Room & finishes → Hardware & faucet: the real pulls, knobs and faucets from the retail catalog.
 *
 * One pull or knob for every door and drawer (it replaces the built-in finish swatches above it)
 * and one faucet for every sink ("The sink's own" keeps each sink's built-in faucet). The chosen
 * one shows its size, price per piece and where to buy it; a link-out is counted per store and
 * product, like the product page's Where to buy.
 */
import { useEffect } from 'react';
import type { Surfaces } from '../types';
import { cad, countClick, loadRetail, loadRetailers, storeLink, storeName, useRetail, useRetailers, type RetailFixtureWire } from './retail';
import { fixtureSize, getFixture } from '../lib/fixtures';
import { useFixtureVersion } from '../lib/useFixtures';
import './retail.css';

/** "Granville 128 mm bar pull · Brushed nickel": the brand and finish are said once, not twice. */
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The name without the brand repeated at its start. */
const withoutBrand = (name: string, brand: string) => name.replace(new RegExp(`^${escapeRe(brand)}\\s+`, 'i'), '');
function shortName(f: RetailFixtureWire): string {
  const word = f.finish.name.toLowerCase().split(' ')[0];
  const [head, ...rest] = withoutBrand(f.name, f.brand).split(/,\s*/);
  return [`${f.brand} ${head}`, ...rest.filter((x) => !x.toLowerCase().includes(word))].join(', ');
}

function Chosen({ id, label }: { id: string; label: string }) {
  useFixtureVersion();
  const f = getFixture(id);
  const info = useRetail((s) => s.byId.get(id));
  const bySlug = useRetailers((s) => s.bySlug);
  if (!f) return null;
  const listings = info?.stores ?? [];
  const size = fixtureSize(f);
  return (
    <div className="fixture-chosen" data-fixture={f.id}>
      <span className="fixture-chosen-name">
        <b>{f.brand}</b> {withoutBrand(f.name, f.brand)}
      </span>
      <span className="fixture-chosen-facts">
        <span>{label}</span>
        {size && <span>{size}</span>}
        <span>{f.finish.name}</span>
        <span className="fixture-chosen-price">{f.priceKnown ? `${cad(f.price)} each` : 'Price at the store'}</span>
      </span>
      {listings.length > 0 && (
        <span className="fixture-chosen-links">
          {listings.map((l) => {
            const cfg = bySlug.get(l.store);
            const count = () => countClick(f.id, l.store);
            return (
              <a key={l.url} className="btn small" href={storeLink(l.url, cfg?.affiliate)} target="_blank" rel="sponsored nofollow noopener" onClick={count} onAuxClick={(e) => e.button === 1 && count()}>
                View at {storeName(l.store)} <span aria-hidden>↗</span>
              </a>
            );
          })}
        </span>
      )}
    </div>
  );
}

export function RetailFixtures({ surfaces, set }: { surfaces: Surfaces; set: (patch: Partial<Surfaces>) => void }) {
  const status = useRetail((s) => s.status);
  const fixtures = useRetail((s) => s.fixtures);
  useFixtureVersion(); // re-render once a kitchen's snapshots or the catalog register
  useEffect(() => {
    void loadRetail();
    void loadRetailers();
  }, []);
  const pulls = fixtures.filter((f) => f.kind === 'pull');
  const knobs = fixtures.filter((f) => f.kind === 'knob');
  const faucets = fixtures.filter((f) => f.kind === 'faucet');
  const hw = getFixture(surfaces.hardwareId);
  const hwRetail = hw && (hw.kind === 'pull' || hw.kind === 'knob') ? hw.id : '';
  const faucet = surfaces.faucetId && getFixture(surfaces.faucetId)?.kind === 'faucet' ? surfaces.faucetId : '';
  // A kitchen saved with a fixture the catalog no longer lists still shows it chosen.
  const orphan = (id: string) => id && !fixtures.some((f) => f.id === id) ? <option value={id}>{getFixture(id)?.name ?? id}</option> : null;

  // The store library is BluModel's internal research: only our staff have it (retail.ts).
  if (status === 'unavailable' && !hwRetail && !faucet) return null;
  if (status !== 'ready' && !hwRetail && !faucet) {
    return <p className="fixture-note">{status === 'error' ? 'Store hardware and faucets didn’t load.' : 'Loading store hardware and faucets…'}</p>;
  }
  return (
    <div className="fixtures">
      <label className="fixture-field">
        <span>Pulls &amp; knobs from stores</span>
        <select value={hwRetail} onChange={(e) => (e.target.value ? set({ hardwareId: e.target.value }) : undefined)} aria-label="Cabinet pulls and knobs from stores">
          <option value="" disabled={!hwRetail}>
            {hwRetail ? 'Choose a finish above instead' : 'A finish above (choose to change)'}
          </option>
          {orphan(hwRetail)}
          <optgroup label={`Pulls (${pulls.length})`}>
            {pulls.map((f) => (
              <option key={f.id} value={f.id}>
                {shortName(f)} · {f.finish.name}
              </option>
            ))}
          </optgroup>
          <optgroup label={`Knobs (${knobs.length})`}>
            {knobs.map((f) => (
              <option key={f.id} value={f.id}>
                {shortName(f)} · {f.finish.name}
              </option>
            ))}
          </optgroup>
        </select>
      </label>
      {hwRetail && <Chosen id={hwRetail} label="On every door and drawer" />}
      <label className="fixture-field">
        <span>Faucet</span>
        <select value={faucet} onChange={(e) => set({ faucetId: e.target.value || undefined })} aria-label="Faucet on every sink">
          <option value="">The sink’s own, in the hardware finish</option>
          {orphan(faucet)}
          <optgroup label={`Faucets (${faucets.length})`}>
            {faucets.map((f) => (
              <option key={f.id} value={f.id}>
                {shortName(f)} · {f.finish.name}
              </option>
            ))}
          </optgroup>
        </select>
      </label>
      {faucet && <Chosen id={faucet} label="On every sink" />}
    </div>
  );
}

// The owner's admin panel (src/features/admin, server/routes/adminPanel.mjs): every new tab at 1440
// and 390, light and dark, with a contrast audit (WCAG AA from computed colours) and no sideways
// scroll; the entry point in the account menu; non-admins kept out (screen and API); and the user
// actions driven through the UI (comp plan, disable / enable, delete with the typed email); and
// Companies > Quick setup end to end (the form, the picture maker it opens, the live link, the
// owner's invite, the new showroom on <slug>.localhost) and a trial's Extend / End / Convert.
// Run: node scripts/qa.mjs --pkg admin --port 8950 --dist .build/admin --strict-external

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { makePng } from '../../../server/lib/synth.mjs';
import { contrastAudit } from './dark.mjs';

const must = (r, what) => {
  if (r.status >= 300) throw new Error(`${what} failed (${r.status}): ${r.body?.error ?? String(r.text ?? '').slice(0, 200)}`);
  return r.body;
};

/** Text that was already under AA in light before dark mode (muted ink, eyebrows): dark.mjs KNOWN_LIGHT. */
const KNOWN_LIGHT_FG = new Set(['#8c8477', '#c2542d', '#3f7d52', '#b7791f']);

async function settle(h) {
  await h.waitUntil(() => !document.querySelector('.screen-msg'), 10_000, 'the tab to finish loading');
  await h.sleep(250);
}

async function noSideScroll(h) {
  const r = await h.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
  if (r.sw > r.w + 1) throw new Error(`the page scrolls sideways: ${r.sw}px of content in a ${r.w}px viewport`);
  // Content can also spill past the right edge while the page itself is clipped: check the panel.
  const spill = await h.evaluate(() => {
    const w = window.innerWidth;
    const out = [...document.querySelectorAll('.admin-main *')].find((e) => {
      const b = e.getBoundingClientRect();
      return b.width > 0 && b.right > w + 1;
    });
    return out ? `${out.tagName.toLowerCase()}.${String(out.className).split(' ')[0]} "${(out.textContent || '').trim().slice(0, 40)}"` : null;
  });
  if (spill) throw new Error(`something runs past the right edge: ${spill}`);
}

async function theme(h, want) {
  const scheme = await h.evaluate(() => document.documentElement.getAttribute('data-theme') || getComputedStyle(document.documentElement).colorScheme);
  if (!String(scheme).includes(want)) throw new Error(`expected the ${want} theme, got "${scheme}"`);
}

async function contrast(h, scheme) {
  const r = await contrastAudit(h);
  const fails = scheme === 'light' ? r.fails.filter((f) => !KNOWN_LIGHT_FG.has(f.fg)) : r.fails;
  h.note(`contrast (${scheme}): ${r.checked} checked, ${r.skipped} skipped, ${fails.length} under AA${scheme === 'light' ? ` (+${r.fails.length - fails.length} known from before dark mode)` : ''}`);
  if (fails.length) throw new Error(`${fails.length} text element(s) under WCAG AA in ${scheme}: ${fails.slice(0, 8).map((f) => `${f.el} "${f.text}" ${f.fg} on ${f.bg} = ${f.ratio}:1`).join('; ')}`);
}

/** No key, secret or token-looking value anywhere in the page's text. */
async function noSecrets(h) {
  const text = await h.evaluate(() => document.body.innerText);
  const m = /(sk|rk)_(live|test)_[A-Za-z0-9]{6,}|whsec_[A-Za-z0-9]{6,}|re_[A-Za-z0-9]{12,}|Bearer [A-Za-z0-9._-]{12,}/.exec(text);
  if (m) throw new Error(`the page shows something secret-looking: ${m[0].slice(0, 12)}…`);
}

const check =
  (scheme, extra) =>
  async (h) => {
    await settle(h);
    if (extra) await extra(h);
    await theme(h, scheme);
    await noSideScroll(h);
    await noSecrets(h);
    await contrast(h, scheme);
  };

/** The same route at 1440 and 390, in light and in dark. */
function four(route) {
  const out = [];
  for (const scheme of ['light', 'dark']) {
    for (const vp of ['desktop', 'phone']) {
      out.push({
        ...route,
        name: `${route.name}${vp === 'phone' ? '-phone' : ''}${scheme === 'dark' ? '-dark' : ''}`,
        viewport: vp,
        colorScheme: scheme,
        fullPage: true,
        check: check(scheme, route.extra),
      });
    }
  }
  return out.map(({ extra, ...r }) => r);
}

/** A contractor on a complimentary plan, with a company and an audit trail, for the screenshots. */
async function seedContractor(api) {
  const me = api.as('fresh');
  const u = await me.user();
  must(await api.as('admin').post(`/api/admin/users/${u.id}/comp`, { plan: 'contractor', endsOn: '2027-01-31', note: 'Launch partner (QA)' }), 'Complimentary plan');
  must(await me.put('/api/pro/profile', { company: 'Ridgeway Kitchens (QA)', phone: '905-555-0142', serviceArea: 'Testville', defaultMarkupPct: 30 }), 'Saving the company');
  return u;
}

/** Opens the account `email` from Admin > Users. */
async function openAccount(h, email) {
  await h.click('.admin-users .home-search input');
  await h.type(email);
  await h.click('.admin-users .home-search button[type="submit"]');
  await h.waitUntil(() => document.querySelectorAll('.adm-table tbody tr').length === 1, 8000, 'the search finding one user');
  await h.click('.adm-table tbody tr .adm-link');
  await h.waitForText(['Complimentary plan', 'Access', 'History']);
}

/** Clicks the first visible button whose text includes `text`. */
async function press(h, text) {
  const ok = await h.evaluate((t) => {
    const b = [...document.querySelectorAll('button')].find((e) => !e.disabled && e.offsetParent && e.textContent.replace(/\s+/g, ' ').trim().toLowerCase().includes(t.toLowerCase()));
    if (b) b.setAttribute('data-qa-press', '1');
    return !!b;
  }, text);
  if (!ok) throw new Error(`no enabled button "${text}"`);
  await h.click('[data-qa-press="1"]');
  await h.evaluate(() => document.querySelector('[data-qa-press]')?.removeAttribute('data-qa-press'));
}

/** The server face: every site listed, 44px buttons, AA contrast, the switch OFF through its confirm, then ON; Update now. */
function faceRoutes() {
  const out = [];
  for (const scheme of ['light', 'dark']) {
    for (const vp of ['desktop', 'phone']) {
      out.push({
        name: `server-face${vp === 'phone' ? '-phone' : ''}${scheme === 'dark' ? '-dark' : ''}`,
        face: true,
        path: '/',
        viewport: vp,
        colorScheme: scheme,
        fullPage: true,
        setup: async ({ home }) => seedUpdates(home),
        expectText: ['BluModel Server', 'All websites are', 'ON', 'Sales site', 'demo.localhost', 'Deployed commit', 'Last backup', 'Last automatic update', 'Memory', 'Update now', 'Checks GitHub daily at 04:00'],
        check: async (h) => {
          const dark = await h.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches);
          if (dark !== (scheme === 'dark')) throw new Error(`expected the ${scheme} scheme`);
          const r = await h.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
          if (r.sw > r.w + 1) throw new Error(`the face scrolls sideways: ${r.sw}px in ${r.w}px`);
          const small = await h.evaluate(() => [...document.querySelectorAll('button')].filter((b) => b.offsetParent && b.getBoundingClientRect().height < 44).map((b) => b.textContent.trim()));
          if (small.length) throw new Error(`buttons under 44px tall: ${small.join(', ')}`);
          const c = await contrastAudit(h);
          h.note(`contrast (${scheme}): ${c.checked} checked, ${c.fails.length} under AA`);
          if (c.fails.length) throw new Error(`under WCAG AA: ${c.fails.slice(0, 5).map((f) => `"${f.text}" ${f.fg} on ${f.bg} = ${f.ratio}:1`).join('; ')}`);
          // Start from ON whatever an earlier route left (a failure there must not cascade).
          if ((await h.evaluate(() => document.getElementById('state').textContent)) === 'OFF') {
            await h.click('#toggle');
            await h.waitForText(['Turn all sites OFF']);
          }
          await h.click('#toggle');
          await h.waitForText(['Turn every website off?', 'Yes, turn them off']);
          await h.shot('confirm');
          await h.click('#yes');
          await h.waitForText(['Turn all sites ON']);
          const st = await h.evaluate(() => document.getElementById('state').textContent);
          if (st !== 'OFF') throw new Error(`the face says ${st} after turning off`);
          await h.shot('off');
          await h.click('#toggle');
          await h.waitForText(['Turn all sites OFF']);
          // Update now: the same trigger as Admin > System; the page then follows the updater.
          await h.click('#update');
          await h.waitForText(['Waiting for the updater to start', 'Updating…']);
          const trigger = path.join(h.home, 'logs', 'update-now.request');
          if (!fs.existsSync(trigger)) throw new Error('Update now on the face left no trigger file');
          await h.shot('updating');
          fs.rmSync(trigger, { force: true });
        },
      });
    }
  }
  return out;
}

/** The automatic update's files in QA's temp home: on at 04:00, the last release rolled back. */
function seedUpdates(home) {
  if (!home) throw new Error('QA gave no temp home');
  fs.mkdirSync(path.join(home, 'logs'), { recursive: true });
  fs.rmSync(path.join(home, 'logs', 'update-now.request'), { force: true });
  fs.writeFileSync(path.join(home, 'auto-update.conf'), 'AUTO_UPDATE=on\nAUTO_UPDATE_TIME=04:00\n');
  const at = (h) => new Date(Date.now() - h * 3_600_000).toISOString();
  fs.writeFileSync(
    path.join(home, 'logs', 'update-status.json'),
    JSON.stringify({
      checkedAt: at(2),
      branch: 'blumodel-studio',
      deployed: '4786039',
      head: '9c1e2d3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d',
      source: 'a61a1a3ce122606b311850555e4093ed3466b0c0',
      result: { at: at(2), from: '4786039', to: '9c1e2d3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d', outcome: 'rolled-back', durationMs: 41_000, error: 'the new version failed its health check and the previous one is running again', by: 'schedule' },
      lastUpdate: { at: at(50), from: '102425b', to: '4786039', outcome: 'updated', durationMs: 38_000, error: null, by: 'schedule' },
      failed: { commit: '9c1e2d3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d', at: at(2) },
    }),
  );
  return {};
}

/** A company with a license, a demo monthly checkout link, a custom domain, credits and a sales lead (once per run). */
async function seedCompany(api) {
  const admin = api.as('admin');
  const made = await admin.post('/api/admin/tenants', { name: 'Ridgeline Cabinets (QA)', slug: 'ridgeline-qa', ownerEmail: 'owner@ridgeline-qa.test', ownerName: 'Robin Ridge' });
  if (made.status !== 201 && made.status !== 409) throw new Error(`making the QA company failed (${made.status}): ${made.body?.error ?? made.text}`);
  const id = made.status === 201 ? made.body.tenant.id : api.sql("SELECT id FROM tenants WHERE slug = 'ridgeline-qa'")[0].id;
  if (made.status === 201) {
    must(await admin.post(`/api/admin/tenants/${id}/licenses`, { amountCents: 179500, paidHow: 'invoice', note: 'Invoice 1042 (QA)' }), 'Recording the license');
    must(await admin.post(`/api/admin/tenants/${id}/monthly/checkout`), 'The monthly checkout link');
    must(await admin.post(`/api/admin/tenants/${id}/hostnames`, { hostname: 'showroom.ridgeline-qa.test', kind: 'custom' }), 'Adding a custom domain');
    must(await admin.post(`/api/admin/tenants/${id}/credits`, { cents: 2500, note: 'Launch credits (QA)' }), 'Adding credits');
    must(await api.post('/api/sales-leads', { company: 'Ridgeline Cabinets (QA)', name: 'Robin Ridge', phone: '519-555-0177', email: 'robin@ridgeline-qa.test', city: 'Guelph', message: 'Saw the demo showroom. Can we talk Thursday?', website: '' }), 'A sales lead');
  }
  return { id, name: 'Ridgeline Cabinets (QA)' };
}

/** Opens a company from Admin > Companies by its name. */
async function openCompany(h, name) {
  await h.waitFor(`button[aria-label="Open ${name}"]`);
  await h.click(`button[aria-label="Open ${name}"]`);
  await h.waitForText(['Yearly license', 'Monthly plan', 'Web addresses', 'Render credits', 'Team', 'Studio queue']);
  await h.sleep(300);
}

// ── Quick setup (src/features/admin/QuickSetup.tsx, server/routes/quickSetup.mjs) ──────────────

/** The page's own `window.open` replaced by a stand-in that records where it was sent (no real tab). */
async function stubWindowOpen(h) {
  await h.evaluate(() => {
    window.__qaOpened = [];
    window.open = () => {
      const w = {
        closed: false,
        opener: {},
        close() {
          w.closed = true;
        },
        location: {
          get href() {
            return 'about:blank';
          },
          set href(v) {
            window.__qaOpened.push(v);
          },
        },
      };
      return w;
    };
  });
}

/** On a phone: every control inside `scope` is at least 44px tall (radios and checkboxes sit in 44px labels). */
async function touchTargets(h, scope) {
  if (h.viewport.w > 500) return;
  const small = await h.evaluate((sc) =>
    [...document.querySelectorAll(`${sc} a[href], ${sc} button, ${sc} input, ${sc} select, ${sc} textarea, ${sc} label.btn`)]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && !(el instanceof HTMLInputElement && ['checkbox', 'radio', 'file'].includes(el.type));
      })
      .filter((el) => el.getBoundingClientRect().height < 43.5)
      .map((el) => `${el.tagName.toLowerCase()} "${(el.textContent || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim().slice(0, 30)}" ${Math.round(el.getBoundingClientRect().height)}px`),
  scope);
  if (small.length) throw new Error(`touch targets under 44px: ${small.slice(0, 8).join('; ')}`);
}

/** Clicks the radio (or checkbox) whose label includes `text`. */
async function choose(h, text) {
  const ok = await h.evaluate((t) => {
    const l = [...document.querySelectorAll('label')].find((e) => e.offsetParent && e.textContent.replace(/\s+/g, ' ').includes(t));
    const i = l?.querySelector('input');
    if (i) i.setAttribute('data-qa-choose', '1');
    return !!i;
  }, text);
  if (!ok) throw new Error(`no choice "${text}"`);
  await h.click('[data-qa-choose="1"]');
  await h.evaluate(() => document.querySelector('[data-qa-choose]')?.removeAttribute('data-qa-choose'));
}

/** Clicks the filter chip whose text starts with `label` ("Trials 2"). */
async function chip(h, label) {
  const ok = await h.evaluate((t) => {
    const b = [...document.querySelectorAll('.adm-filters button')].find((e) => e.textContent.trim().startsWith(t));
    if (b) b.setAttribute('data-qa-chip', '1');
    return !!b;
  }, label);
  if (!ok) throw new Error(`no filter "${label}"`);
  await h.click('[data-qa-chip="1"]');
  await h.evaluate(() => document.querySelector('[data-qa-chip]')?.removeAttribute('data-qa-chip'));
}

/** Sets a React-controlled input's value (select-all and type). */
async function fill(h, selector, text) {
  await h.click(selector);
  await h.key('a', { modifiers: ['ctrl'] });
  await h.key('Backspace');
  if (text) await h.type(text);
}

/** A request to a showroom host from Node (fetch can't set Host): { status, body }. */
function hostRequest(base, host, method, p, { headers = {}, body } = {}) {
  const u = new URL(base);
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port: u.port, path: p, method, headers: { Host: `${host}:${u.port}`, ...(method !== 'GET' ? { 'X-BluModel': '1' } : {}), ...headers } },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed = null;
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = null;
          }
          resolve({ status: res.statusCode, body: parsed, text });
        });
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/**
 * What the picture generator does in the admin's browser, done from Node so QA doesn't render
 * 10 scenes four times: opens with the ticket, uploads a main picture, says it has finished.
 */
async function playGenerator(h, url) {
  const u = new URL(url.replace('/#/', '/'));
  const ticket = u.searchParams.get('ticket');
  const host = u.hostname;
  const hdr = { 'X-Showroom-Ticket': ticket };
  const access = await hostRequest(h.base, host, 'GET', '/api/showroom-images/access', { headers: hdr });
  if (access.status !== 200) throw new Error(`the generator's ticket was refused (${access.status})`);
  const png = makePng({ w: 1200, h: 675, rgba: (x, y) => [70 + Math.round((x / 1200) * 120), 90 + Math.round((y / 675) * 60), 120, 255] });
  const up = await hostRequest(h.base, host, 'PUT', '/api/showroom-images?slot=hero&source=render', { headers: { ...hdr, 'Content-Type': 'image/png' }, body: png });
  if (up.status !== 200) throw new Error(`uploading the main picture failed (${up.status}): ${up.text.slice(0, 200)}`);
  const done = await hostRequest(h.base, host, 'POST', '/api/showroom-images/done', { headers: { ...hdr, 'Content-Type': 'application/json' }, body: JSON.stringify({ made: 1, failed: 0 }) });
  if (done.status !== 200) throw new Error(`"done" failed (${done.status})`);
}

/** A 96 px logo in two clear colours (navy and amber), for "pick from logo". */
function logoFile(tag) {
  const file = path.join(os.tmpdir(), `qa-quick-setup-logo-${tag}.png`);
  fs.writeFileSync(file, makePng({ w: 96, h: 96, rgba: (x, y) => ((x - 48) ** 2 + (y - 48) ** 2 > 2100 ? [255, 255, 255, 0] : y < 52 ? [27, 58, 107, 255] : [224, 150, 32, 255]) }));
  return file;
}

async function setFile(h, selector, file) {
  const { root } = await h.send('DOM.getDocument', { depth: 1 });
  const { nodeId } = await h.send('DOM.querySelector', { nodeId: root.nodeId, selector });
  if (!nodeId) throw new Error(`no ${selector}`);
  await h.send('DOM.setFileInputFiles', { files: [file], nodeId });
}

/** The whole quick setup through the screen, ending on the new showroom at <slug>.localhost. */
const quickSetupFlow = (scheme) => async (h) => {
  await settle(h);
  await h.waitForText(['Quick setup', 'Set up the showroom', 'Starter catalog', 'Prospect trial']);
  await stubWindowOpen(h);
  const tag = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  const name = `Lakeview ${tag} Kitchens`;
  const slug = `lakeview-${tag}-kitchens`;
  await fill(h, 'input[placeholder="Acme Kitchens & Bath"]', name);
  // The address is suggested from the name and checked live.
  await h.waitUntil(new Function(`return document.querySelector('input[placeholder="acme"]')?.value === ${JSON.stringify(slug)}`), 8000, 'the address suggested from the name');
  await h.waitForText(`${slug}.localhost`);
  await h.waitForText('is free');
  await fill(h, 'input[placeholder="acme"]', 'admin');
  await h.waitForText('That name is reserved.');
  const disabled = await h.evaluate(() => document.querySelector('.qs-go')?.disabled);
  if (disabled !== true) throw new Error('Set up the showroom is enabled with a reserved address');
  await fill(h, 'input[placeholder="acme"]', slug);
  await h.waitForText('is free');
  // Logo, and its colours picked for the brand.
  await setFile(h, '.qs-file input', logoFile(tag));
  await h.waitForText(['From the logo:', 'Change logo']);
  const colours = await h.evaluate(() => [...document.querySelectorAll('.qs-colour input:not([type="color"])')].map((i) => i.value));
  h.note(`colours from the logo: ${colours.join(', ')}`);
  if (colours[0] === '#1f4f8a' || colours[1] === '#e8a838') throw new Error('the colours weren’t taken from the logo');
  await h.waitForText(['White text on the main colour', 'As text on the page']);
  await fill(h, 'input[placeholder="acmekitchens.ca"]', `lakeview-${tag}.example`);
  await fill(h, 'input[placeholder="Guelph and Wellington County"]', 'Kingston and the Thousand Islands');
  await fill(h, 'input[placeholder="(519) 555-0142"]', '(613) 555-0199');
  await fill(h, 'input[placeholder="hello@acmekitchens.ca"]', `hello@lakeview-${tag}.example`);
  await h.waitForText(`Lakeview ${tag} Shaker`);
  await touchTargets(h, '.qs-form');
  await h.shot('form');
  await press(h, 'Set up the showroom');
  await h.waitForText([`${name} is set up.`, 'Skip: show me the link'], 15_000);
  const opened = await h.evaluate(() => window.__qaOpened ?? []);
  if (opened.length !== 1) throw new Error(`the picture maker was opened ${opened.length} times`);
  if (!opened[0].startsWith(`http://${slug}.localhost:`) || !/#\/showroom-images\?ticket=[^&]+&auto=1$/.test(opened[0])) throw new Error(`the picture maker opened at ${opened[0]}`);
  await h.shot('pictures');
  await playGenerator(h, opened[0]);
  // The panel notices the run is done and shows the live link.
  await h.waitForText([`${name}’s showroom is live`, 'Trial · 14 days left', '1 picture made', 'Invite the owner', 'Record the license', 'Send the $50 monthly link', 'Convert to a paying customer'], 15_000);
  const link = await h.evaluate(() => document.querySelector('input[aria-label="The showroom’s live link"]')?.value);
  if (!new RegExp(`^http://${slug}\\.localhost:\\d+$`).test(link ?? '')) throw new Error(`the live link is ${link}`);
  const open = await h.evaluate(() => [...document.querySelectorAll('a')].find((a) => a.textContent.trim() === 'Open the showroom')?.getAttribute('href'));
  if (open !== link) throw new Error(`Open the showroom goes to ${open}`);
  // Invite the owner (the pending-invite flow).
  await fill(h, '.qs-done input[placeholder="owner@acmekitchens.ca"]', `owner-${tag}@lakeview.example`);
  await press(h, 'Invite the owner');
  await h.waitForText(`Sign-in link for owner-${tag}@lakeview.example`);
  await touchTargets(h, '.qs-panel');
  // The panel itself: theme, no sideways scroll, nothing secret-looking (the invite link aside), contrast.
  await theme(h, scheme);
  await noSideScroll(h);
  await contrast(h, scheme);
  await h.shot('done');
  // The audit trail.
  const audit = await h.evaluate(async () => (await fetch('/api/admin/audit?action=tenant_quick_setup', { credentials: 'same-origin' })).json());
  if (!audit.entries?.some((e) => e.detail?.slug === slug && e.detail?.purpose === 'trial' && e.detail?.products > 30)) throw new Error('the quick setup is not in the audit log');

  // Then the new showroom itself, as a visitor, on <slug>.localhost.
  await h.evaluate((u) => {
    location.href = `${u}/?qa=1#/`;
  }, link);
  await h.waitUntil(new Function(`return location.hostname === ${JSON.stringify(`${slug}.localhost`)} && !!document.querySelector('#root *') && document.body.innerText.includes(${JSON.stringify(`Lakeview ${tag}`)})`), 20_000, 'the new showroom loading');
  await h.waitForText([`Design your new kitchen with Lakeview ${tag}`, `Lakeview ${tag} Shaker`, 'Kingston and the Thousand Islands'], 15_000);
  const page = await h.evaluate(async () => {
    const cfg = await (await fetch('/api/config', { credentials: 'same-origin' })).json();
    const cat = await (await fetch('/api/catalog', { credentials: 'same-origin' })).json();
    return { site: cfg.site, status: cfg.tenant?.status, logo: cfg.tenant?.branding?.logoUrl, hero: cfg.tenant?.images?.hero?.url ?? null, products: cat.products?.length ?? 0, text: document.body.innerText };
  });
  if (page.site !== 'showroom' || page.status !== 'live') throw new Error(`the showroom says site ${page.site}, status ${page.status}`);
  if (!page.logo) throw new Error('the showroom has no logo');
  if (!page.hero) throw new Error('the uploaded main picture is not on the showroom');
  if (page.products < 30) throw new Error(`the showroom has ${page.products} products`);
  if (/northline|\(demo\)/i.test(page.text)) throw new Error('the new showroom mentions Northline or Demo');
  await noSideScroll(h);
  await h.shot('showroom');
};

/** Quick setup at 1440 and 390, light and dark. */
function quickSetupViews() {
  const out = [];
  for (const scheme of ['light', 'dark']) {
    for (const vp of ['desktop', 'phone']) {
      out.push({
        name: `admin-quick-setup${vp === 'phone' ? '-phone' : ''}${scheme === 'dark' ? '-dark' : ''}`,
        path: '#/admin/companies',
        as: 'admin',
        viewport: vp,
        colorScheme: scheme,
        timeoutMs: 30_000,
        check: quickSetupFlow(scheme),
      });
    }
  }
  return out;
}

export default [
  // ── the tabs, 1440 / 390, light / dark ───────────────────────────────────
  ...four({ name: 'admin-overview', path: '#/admin/overview', as: 'admin', setup: async ({ api }) => (await seedContractor(api), {}), expectText: ['Overview', 'Showrooms', 'Companies live', 'Monthly recurring revenue', 'Licenses booked', 'Render credits used', 'Legacy homeowner and contractor plans', 'Recent sign-ups', 'Recent payments'] }),
  ...four({ name: 'admin-users', path: '#/admin/users', as: 'admin', expectText: ['Users', 'Search by name or email'] }),
  ...four({
    name: 'admin-user-detail',
    path: '#/admin/users',
    as: 'admin',
    setup: async ({ api }) => {
      const u = await seedContractor(api);
      return { email: u.email };
    },
    expectText: ['Users'],
    extra: async (h) => {
      await openAccount(h, h.data.email);
      await h.waitForText(['complimentary', 'make-admin.mjs', 'Delete the account']);
    },
  }),
  ...four({ name: 'admin-contractors', path: '#/admin/contractors', as: 'admin', setup: async ({ api }) => (await seedContractor(api), {}), expectText: ['Contractors', 'Brand page', 'Models'] }),
  ...four({
    name: 'admin-companies',
    path: '#/admin/companies',
    as: 'admin',
    setup: async ({ api }) => (await seedCompany(api), {}),
    // Each company's lead counts (total, this month, sent), never the people (docs/handoff/leads.md).
    expectText: ['Companies', 'New company', 'Ridgeline Cabinets (QA)', 'Northline Kitchen', 'this month', 'sent'],
    extra: async (h) => {
      const text = await h.evaluate(() => document.body.innerText);
      if (/morgan\.lee@example\.test|Riley Okafor|Sam Patel/.test(text)) throw new Error('Admin > Companies shows a showroom’s lead by name or address');
    },
  }),
  ...four({
    name: 'admin-company-detail',
    path: '#/admin/companies',
    as: 'admin',
    setup: async ({ api }) => seedCompany(api),
    expectText: ['Companies'],
    extra: async (h) => {
      await openCompany(h, h.data.name);
      await h.waitForText(['Invoice 1042 (QA)', 'Checkout link to send', 'showroom.ridgeline-qa.test', 'Not verified', 'Launch credits (QA)', 'owner@ridgeline-qa.test']);
    },
  }),
  ...four({ name: 'admin-sales-leads', path: '#/admin/sales-leads', as: 'admin', setup: async ({ api }) => (await seedCompany(api), {}), expectText: ['Sales leads', 'Ridgeline Cabinets (QA)', 'Can we talk Thursday?', 'Our notes'] }),
  ...four({ name: 'admin-system', path: '#/admin/system', as: 'admin', expectText: ['System', 'Payments', 'Webhook signing secret', 'Database and backups', 'blumodel.env'] }),
  // Admin > System > Updates: the files the automatic update writes, in QA's temp home (never a real
  // one), showing a rolled-back release; then Update now through its confirm leaves the trigger file.
  ...four({
    name: 'admin-system-updates',
    path: '#/admin/system',
    as: 'admin',
    setup: async ({ home }) => seedUpdates(home),
    expectText: ['Updates', 'Checks GitHub daily at 4:00 am', 'Rolled back', 'blumodel-studio', 'did not go live', 'Update now'],
    extra: async (h) => {
      await h.evaluate(() => document.getElementById('adm-updates')?.scrollIntoView({ block: 'start' }));
      await press(h, 'Update now');
      await h.waitForText(['Yes, update now', 'the site restarts for a few seconds']);
      await press(h, 'Yes, update now');
      await h.waitForText(['Requested.', 'Update requested']);
      const trigger = path.join(h.home, 'logs', 'update-now.request');
      if (!fs.existsSync(trigger)) throw new Error(`Update now did not leave ${trigger}`);
      h.note('Update now left logs/update-now.request in the temp home');
      await h.evaluate(() => document.getElementById('adm-updates')?.scrollIntoView({ block: 'start' }));
    },
  }),
  // Admin > System > All websites: OFF (through its confirm) puts every site in maintenance - the
  // health check says so - while this admin keeps the page; then ON again (the run goes on after).
  // (What a visitor gets while it's off is server/test/sites-switch.test.mjs: a 503 here would fail QA.)
  ...four({
    name: 'admin-sites-switch',
    path: '#/admin/system',
    as: 'admin',
    expectText: ['All websites', 'Turn all sites off'],
    extra: async (h) => {
      await press(h, 'Turn all sites off');
      await h.waitForText(['Yes, turn every site off', 'Nothing is deleted']);
      await press(h, 'Yes, turn every site off');
      await h.waitForText(['OFF (maintenance)', 'Turn all sites on']);
      const health = await h.evaluate(() => fetch('/api/health').then((r) => r.json()));
      await h.shot('off');
      // Back ON before judging, so a failure here never leaves the rest of the run in maintenance.
      await press(h, 'Turn all sites on');
      await h.waitForText(['Turn all sites off']);
      if (health.maintenance !== true) throw new Error(`/api/health did not say maintenance: ${JSON.stringify(health)}`);
      const after = await h.evaluate(() => fetch('/api/health').then((r) => r.json()));
      if (after.maintenance) throw new Error('still in maintenance after turning the sites on');
    },
  }),
  ...four({ name: 'admin-audit', path: '#/admin/audit', as: 'admin', setup: async ({ api }) => (await seedContractor(api), {}), expectText: ['Audit log', 'Complimentary plan given'] }),

  // ── the server face (server/face/face.mjs, 127.0.0.1:<port + 1>) at 1440 and 390, light and dark ─
  ...faceRoutes(),

  // ── entry point and access ───────────────────────────────────────────────
  {
    name: 'admin-menu-entry',
    path: '#/',
    as: 'admin',
    check: async (h) => {
      await h.waitFor('button.avatar');
      await h.click('button.avatar');
      await h.waitForText('Admin');
      await press(h, 'Admin');
      await h.waitUntil(() => location.hash === '#/admin/overview', 6000, 'Admin opening the overview');
      await h.waitForText(['Monthly recurring revenue', 'Contractors', 'System', 'Audit']);
    },
  },
  {
    name: 'admin-menu-hidden-for-customers',
    path: '#/',
    as: 'customer',
    check: async (h) => {
      await h.waitFor('button.avatar');
      await h.click('button.avatar');
      await h.waitForText('Account settings');
      const items = await h.evaluate(() => [...document.querySelectorAll('.menu [role="menuitem"]')].map((e) => e.textContent.trim()));
      if (items.some((t) => /^Admin/.test(t))) throw new Error(`a customer's menu offers Admin: ${items.join(', ')}`);
    },
  },
  {
    name: 'admin-forbidden-customer',
    path: '#/admin/system',
    as: 'customer',
    expectText: 'This area is for BluModel Studio staff.',
    check: async (h) => {
      for (const p of ['/api/admin/dashboard', '/api/admin/system', '/api/admin/audit', '/api/admin/contractors', '/api/admin/users', '/api/admin/tenants', '/api/admin/showrooms/overview', '/api/admin/showrooms/queue', '/api/admin/sales-leads']) {
        const status = await h.evaluate(async (u) => (await fetch(u, { credentials: 'same-origin' })).status, p);
        if (status !== 403) throw new Error(`${p} answered ${status} to a customer (expected 403)`);
      }
      const status = await h.evaluate(async () => (await fetch('/api/admin/users/x/disable', { method: 'POST', credentials: 'same-origin', headers: { 'X-BluModel': '1', 'Content-Type': 'application/json' }, body: '{}' })).status);
      if (status !== 403) throw new Error(`a customer's disable answered ${status}`);
    },
  },
  {
    name: 'admin-studio-sees-only-studio',
    path: '#/admin/users',
    as: 'studio',
    check: async (h) => {
      await h.waitUntil(() => location.hash === '#/admin/studio', 8000, 'the studio role being sent to its own tab');
      const tabs = await h.evaluate(() => [...document.querySelectorAll('.admin-tabs [role="tab"]')].map((e) => e.textContent.trim()));
      if (tabs.join(',') !== 'Studio') throw new Error(`the studio role sees tabs: ${tabs.join(', ')}`);
    },
  },

  // ── two-factor sign-in (server/auth/mfa.mjs) ────────────────────────────
  {
    // The admin signs in through the page: password, then the code from the app; the admin pages open.
    name: 'admin-signin-2fa',
    path: '#/signin?next=%23%2Fadmin%2Foverview',
    as: 'anon',
    viewport: 'phone',
    waitFor: ['input[type="email"]', 'input[autocomplete="current-password"]'],
    setup: async ({ api }) => ({ email: 'demo-admin@blumodel.test', password: api.password, code: await api.totpCode() }),
    check: async (h) => {
      await fill(h, 'input[type="email"]', h.data.email);
      await fill(h, 'input[autocomplete="current-password"]', h.data.password);
      await press(h, 'Sign in');
      await h.waitForText(['Enter your code', 'Lost your phone? Use a recovery code']);
      await touchTargets(h, '.auth-form');
      await h.shot('code-step');
      await fill(h, 'input[autocomplete="one-time-code"]', h.data.code);
      await press(h, 'Sign in');
      await h.waitUntil(() => location.hash === '#/admin/overview', 10_000, 'the admin overview after the code');
      await h.waitForText(['Monthly recurring revenue']);
      const me = await h.evaluate(async () => (await (await fetch('/api/auth/me', { credentials: 'same-origin' })).json()).user.mfa);
      if (!me?.enabled || !me.verified) throw new Error(`after the code the session says ${JSON.stringify(me)}`);
      await noSideScroll(h);
    },
  },
  {
    // A dangerous action after the re-authentication window: "Confirm it's you" asks for the password
    // and a code, then the action goes through.
    name: 'admin-reauth-dialog',
    path: '#/admin/users',
    as: 'admin',
    setup: async ({ api }) => {
      const email = (await api.as('fresh').user()).email;
      // This admin last proved the password long ago (the QA server's window is 240 minutes).
      api.sql("UPDATE sessions SET auth_at = 0 WHERE user_id = (SELECT id FROM users WHERE email = 'demo-admin@blumodel.test' AND tenant_id IS NULL)");
      return { email, password: api.password, code: await api.totpCode() };
    },
    check: async (h) => {
      await settle(h);
      await openAccount(h, h.data.email);
      await press(h, 'Create reset link');
      await h.waitForText(['Confirm it’s you', 'and a code from your authenticator app']);
      await touchTargets(h, '.reauth-form');
      await h.shot('confirm');
      await fill(h, '.reauth-form input[type="password"]', h.data.password);
      await fill(h, '.reauth-form input[autocomplete="one-time-code"]', h.data.code);
      await press(h, 'Confirm');
      await h.waitForText(`Reset link for ${h.data.email}`, 10_000);
    },
  },
  {
    // An admin without two-factor sign-in sees only the enrolment, then the admin pages once it is on.
    name: 'admin-enrol-2fa',
    path: '#/admin/overview',
    as: 'fresh',
    setup: async ({ api }) => {
      const me = await api.as('fresh').user();
      api.sql("UPDATE users SET role = 'admin' WHERE id = ?", me.id);
      return { password: api.password };
    },
    check: async (h) => {
      await h.waitForText(['Turn on two-factor sign-in', 'Set it up now to open the admin pages']);
      const status = await h.evaluate(async () => (await fetch('/api/admin/tenants', { credentials: 'same-origin' })).status);
      if (status !== 403) throw new Error(`an admin without 2FA got ${status} from an admin route`);
      await fill(h, '.mfa input[type="password"]', h.data.password);
      await press(h, 'Set up');
      await h.waitForText(['open this link in your authenticator app', 'Enter the 6-digit code']);
      await touchTargets(h, '.mfa');
      await noSideScroll(h);
      await h.shot('enrol');
    },
  },

  // ── actions through the UI ───────────────────────────────────────────────
  {
    name: 'admin-disable-enable',
    path: '#/admin/users',
    as: 'admin',
    viewport: 'phone',
    setup: async ({ api }) => ({ email: (await api.as('fresh').user()).email }),
    check: async (h) => {
      await settle(h);
      await openAccount(h, h.data.email);
      await press(h, 'Disable account');
      await press(h, 'Yes, disable it');
      await h.waitForText(['Account disabled and signed out everywhere', 'can’t sign in until it is enabled again']);
      const res = await h.evaluate(async () => (await fetch('/api/admin/audit?action=account_disable', { credentials: 'same-origin' })).json());
      if (!res.entries?.length) throw new Error('the disable is not in the audit log');
      await press(h, 'Enable account');
      await h.waitForText('Account enabled.');
      await noSideScroll(h);
    },
  },
  {
    name: 'admin-comp-and-delete',
    path: '#/admin/users',
    as: 'admin',
    setup: async ({ api }) => ({ email: (await api.as('fresh').user()).email }),
    check: async (h) => {
      await settle(h);
      await openAccount(h, h.data.email);
      await press(h, 'Give complimentary plan');
      await h.waitForText(['Complimentary Contractor given', 'End it now']);
      await press(h, 'End it now');
      await h.waitForText('Complimentary plan ended.');
      // Delete: the button stays disabled until the email is typed exactly.
      const before = await h.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Delete account permanently'))?.disabled);
      if (before !== true) throw new Error('Delete is enabled before the email is typed');
      await h.click('input[aria-label="Type the account’s email to confirm deletion"]');
      await h.type(h.data.email);
      await press(h, 'Delete account permanently');
      await h.waitForText(['was deleted', 'The audit log keeps the record']);
      const res = await h.evaluate(async () => (await fetch('/api/admin/audit?action=account_delete', { credentials: 'same-origin' })).json());
      if (!res.entries?.some((e) => e.targetEmail)) throw new Error('the delete is not in the audit log');
    },
  },

  // ── companies through the UI ─────────────────────────────────────────────
  {
    // A company that leaves: the export link (a zip of its data) and Delete company with the typed slug.
    name: 'admin-company-leaving',
    path: '#/admin/companies',
    as: 'admin',
    check: async (h) => {
      await settle(h);
      const tag = Date.now().toString(36);
      const name = `Leaving Co QA ${tag}`;
      await press(h, 'New company');
      await h.click('input[placeholder="Acme Kitchens"]');
      await h.type(name);
      await press(h, 'Create company');
      await h.waitForText(['If the company leaves', 'Export all data', 'Delete company…']);
      const slug = await h.evaluate(async (n) => (await (await fetch('/api/admin/tenants', { credentials: 'same-origin' })).json()).tenants.find((x) => x.name === n)?.slug, name);
      if (!slug) throw new Error('the new company is not listed');
      // The zip itself, as the button's link gets it.
      const zip = await h.evaluate(async (n) => {
        const t = (await (await fetch('/api/admin/tenants', { credentials: 'same-origin' })).json()).tenants.find((x) => x.name === n);
        const link = await (await fetch(`/api/admin/tenants/${t.id}/export`, { method: 'POST', credentials: 'same-origin', headers: { 'X-BluModel': '1', 'Content-Type': 'application/json' }, body: '{}' })).json();
        const r = await fetch(link.url, { credentials: 'same-origin' });
        const b = new Uint8Array(await r.arrayBuffer());
        return { status: r.status, type: r.headers.get('content-type'), magic: [b[0], b[1]] };
      }, name);
      if (zip.status !== 200 || zip.type !== 'application/zip' || zip.magic[0] !== 0x50 || zip.magic[1] !== 0x4b) throw new Error(`the export answered ${JSON.stringify(zip)}`);
      await press(h, 'Delete company…');
      await h.waitForText(`Delete ${name} for good?`);
      await touchTargets(h, '#adm-leaving');
      const before = await h.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Delete company permanently'))?.disabled);
      if (before !== true) throw new Error('Delete is enabled before the address is typed');
      await h.click('input[aria-label="Type the showroom’s address to confirm deletion"]');
      await h.type(slug);
      await h.shot('confirm');
      await press(h, 'Delete company permanently');
      await h.waitUntil(new Function(`return !document.body.innerText.includes(${JSON.stringify(`Delete ${name} for good?`)})`), 10_000, 'the company page to close');
      const audit = await h.evaluate(async () => (await fetch('/api/admin/audit?action=tenant_delete', { credentials: 'same-origin' })).json());
      if (!audit.entries?.some((e) => e.detail?.slug === slug)) throw new Error('the deletion is not in the audit log');
      const still = await h.evaluate(async (n) => (await (await fetch('/api/admin/tenants', { credentials: 'same-origin' })).json()).tenants.some((x) => x.name === n), name);
      if (still) throw new Error('the company is still listed');
    },
  },
  {
    name: 'admin-company-lifecycle',
    path: '#/admin/companies',
    as: 'admin',
    viewport: 'phone',
    check: async (h) => {
      await settle(h);
      const tag = Date.now().toString(36);
      const name = `Maple Lane Kitchens QA ${tag}`;
      await press(h, 'New company');
      await h.click('input[placeholder="Acme Kitchens"]');
      await h.type(name);
      await h.click('input[placeholder="owner@acmekitchens.ca"]');
      await h.type(`owner-${tag}@maple-qa.test`);
      await press(h, 'Create company');
      await h.waitForText(['Sign-in link', 'Yearly license', 'Setting up']);
      // Record the license (there is no list price: the amount must be typed, and the button waits
      // for it), make the monthly plan complimentary, launch.
      const amountInput = 'input[placeholder="The amount agreed"]';
      const prefilled = await h.evaluate((sel) => document.querySelector(sel)?.value ?? null, amountInput);
      if (prefilled !== '') throw new Error(`the license amount is prefilled: ${JSON.stringify(prefilled)}`);
      const recordDisabled = await h.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Record license')?.disabled);
      if (recordDisabled !== true) throw new Error('Record license is enabled without an amount');
      await h.click(amountInput);
      await h.type('1250');
      await press(h, 'Record license');
      await h.waitForText('License recorded: $1,250 CAD');
      await h.click('input[aria-label="Why the plan is complimentary"]');
      await h.type('Launch partner (QA)');
      await press(h, 'Make it complimentary');
      await h.waitForText('Complimentary monthly plan on.');
      await press(h, 'Launch showroom');
      await h.waitForText('is live.');
      // A custom domain, verified.
      await h.click('input[placeholder="showroom.acmekitchens.ca"]');
      await h.type(`design-${tag}.maple-qa.test`);
      await press(h, 'Add address');
      await h.waitForText('Follow the Cloudflare steps');
      await press(h, 'Mark verified');
      await h.waitForText('it now opens the showroom');
      // Credits need a reason.
      await h.click('input[placeholder="25"]');
      await h.type('10');
      const disabled = await h.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Add credits')?.disabled);
      if (disabled !== true) throw new Error('Add credits is enabled without a reason');
      await h.click('input[placeholder^="e.g. Make-good"]');
      await h.type('Make-good (QA)');
      await press(h, 'Add credits');
      await h.waitForText('of credits.');
      // Suspend (reason required, confirmed) and restore.
      await h.click('input[placeholder^="e.g. Asked to pause"]');
      await h.type('Paused for the QA run');
      await press(h, 'Suspend');
      await press(h, 'Yes, suspend');
      await h.waitForText('is suspended.');
      await press(h, 'Restore showroom');
      await h.waitForText('is live.');
      await noSideScroll(h);
      const res = await h.evaluate(async () => (await fetch('/api/admin/audit?action=tenant_credit_adjust', { credentials: 'same-origin' })).json());
      if (!res.entries?.some((e) => e.detail?.note === 'Make-good (QA)')) throw new Error('the credit adjustment is not in the audit log');
    },
  },
  {
    name: 'admin-sales-lead-status',
    path: '#/admin/sales-leads',
    as: 'admin',
    setup: async ({ api }) => (await seedCompany(api), {}),
    check: async (h) => {
      await settle(h);
      await h.waitForText('Can we talk Thursday?');
      const ok = await h.evaluate(() => {
        const sel = document.querySelector('.adm-lead select');
        if (!sel) return false;
        const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
        set.call(sel, 'contacted');
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      });
      if (!ok) throw new Error('no status select on the lead');
      await h.waitForText('Saved.');
      const res = await h.evaluate(async () => (await fetch('/api/admin/audit?action=sales_lead_update', { credentials: 'same-origin' })).json());
      if (!res.entries?.length) throw new Error('the sales lead change is not in the audit log');
    },
  },
  // ── Quick setup: the whole flow, 1440 / 390, light / dark, ending on the new showroom ──────
  ...quickSetupViews(),
  {
    // A paying customer with an empty catalog: no picture maker, straight to the link; it starts in setup.
    name: 'admin-quick-setup-customer',
    path: '#/admin/companies',
    as: 'admin',
    check: async (h) => {
      await settle(h);
      await stubWindowOpen(h);
      const tag = `${Date.now().toString(36)}c`;
      await fill(h, 'input[placeholder="Acme Kitchens & Bath"]', `Spruce ${tag} Renovations`);
      await h.waitForText(`spruce-${tag}-renovations.localhost`);
      await choose(h, 'Empty, we’ll model theirs');
      await choose(h, 'Paying customer');
      await press(h, 'Set up the showroom');
      await h.waitForText([`Spruce ${tag} Renovations’s showroom is set up.`, 'Setting up', 'No catalog yet', 'Launch the showroom']);
      if ((await h.evaluate(() => window.__qaOpened?.length ?? 0)) !== 0) throw new Error('the picture maker opened for an empty catalog');
      await noSideScroll(h);
    },
  },
  {
    // Trials in the list and on a company's page: days left, Extend 7 days, End trial, and Convert
    // (only once a license is recorded and the monthly plan is paid or complimentary).
    name: 'admin-trial-actions',
    path: '#/admin/companies',
    as: 'admin',
    setup: async ({ api }) => {
      const admin = api.as('admin');
      const tag = Date.now().toString(36);
      const a = must(await admin.post('/api/admin/quick-setup', { name: `Willow ${tag} Kitchens`, catalog: 'empty', purpose: 'trial' }), 'A quick setup');
      const b = must(await admin.post('/api/admin/quick-setup', { name: `Aspen ${tag} Kitchens`, catalog: 'empty', purpose: 'trial' }), 'A second quick setup');
      return { name: a.tenant.name, other: b.tenant.name };
    },
    check: async (h) => {
      await settle(h);
      await chip(h, 'Trials');
      await h.waitForText([h.data.name, h.data.other, 'Trial · 14 days left']);
      await h.click(`button[aria-label="Extend ${h.data.name}’s trial by 7 days"]`);
      await h.waitForText('Trial · 21 days left');
      // Ending one: it stays in the Trials list, marked ended, and visitors get "temporarily unavailable".
      await h.click(`button[aria-label="End ${h.data.other}’s trial"]`);
      await press(h, 'Yes, end it');
      await h.waitForText(['Trial ended', h.data.other]);
      await h.click(`button[aria-label="Open ${h.data.name}"]`);
      await h.waitForText(['Trial', 'Convert to paying customer', 'To convert, first record the license']);
      const blocked = await h.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Convert to paying customer')?.disabled);
      if (blocked !== true) throw new Error('Convert is enabled with no license or monthly plan');
      // Record the license and make the plan complimentary, through the company's own sections.
      await h.click('input[placeholder="The amount agreed"]');
      await h.type('1250');
      await press(h, 'Record license');
      await h.waitForText('License recorded');
      await h.click('input[aria-label="Why the plan is complimentary"]');
      await h.type('Pilot (QA)');
      await press(h, 'Make it complimentary');
      await h.waitForText(['Complimentary monthly plan on.', 'License and monthly plan are in place']);
      await press(h, 'Convert to paying customer');
      await h.waitForText(`${h.data.name} is a paying customer now, and live.`);
      await noSideScroll(h);
      for (const a of ['tenant_trial_extend', 'tenant_trial_end', 'tenant_trial_convert']) {
        const r = await h.evaluate(async (x) => (await fetch(`/api/admin/audit?action=${x}`, { credentials: 'same-origin' })).json(), a);
        if (!r.entries?.length) throw new Error(`${a} is not in the audit log`);
      }
    },
  },
];

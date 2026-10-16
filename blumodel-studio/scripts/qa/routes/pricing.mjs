// The 2026-10-15 pricing change (key 'pricing'). Run with
//   node scripts/qa.mjs --pkg pricing --port 8882 --dist .build/pricing --strict-external
//
//   - Prices are Canadian dollars: Unlimited $15 CAD/month, Contractor $99 CAD/month.
//   - The Contractor plan includes 3 custom 3D models a month, made by the studio; nothing is sold
//     per model (no Model pack, no rush, no checkout). The QA contractor (qa-contractor@…, a DEMO
//     subscription) sends a request, withdraws it, runs out, and the studio and an admin act on it.
//   - The $5 kitchen unlock isn't advertised: not on the landing or pricing page, not on Billing;
//     a free user meets it only in the export dialog.
// Routes that need models make sure the QA contractor has some (an admin grant if not), so they
// don't depend on the order the other packages' routes ran in.

const PHONE = { w: 390, h: 844, mobile: true };
const DESKTOP = { w: 1440, h: 900 };
const CONTRACTOR_EMAIL = 'qa-contractor@blumodel.test';

const SIDEWAYS = 'document.documentElement.scrollWidth > window.innerWidth + 1';
const bodyHas = (t) => `document.body.textContent.includes(${JSON.stringify(t)})`;
const waitFor = (expr, ms = 5000) => `(async () => {
  const end = Date.now() + ${ms};
  while (Date.now() < end) {
    if (${expr}) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
})()`;
/** Clicks the first enabled button or link whose text includes `label` (inside `scope`). */
const click = (label, scope = 'body') => `(() => {
  const b = [...document.querySelector(${JSON.stringify(scope)}).querySelectorAll('button, a, summary')].find((x) => x.textContent.includes(${JSON.stringify(label)}) && !x.disabled);
  if (!b) return false;
  b.click();
  return true;
})()`;

/** The QA contractor's allowance now. */
async function allowanceOf(api) {
  const r = await api.as('contractor').get('/api/orders/allowance');
  if (r.status !== 200 || !r.body?.allowance?.active) throw new Error(`the QA contractor has no Contractor-plan allowance: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.allowance;
}

/** At least `n` models left for the QA contractor this month (an audited admin grant if not). */
async function ensureModels(api, n) {
  const a = await allowanceOf(api);
  if (a.left >= n) return a;
  const g = await api.as('admin').post('/api/admin/model-grants', { email: CONTRACTOR_EMAIL, models: n - a.left, note: 'QA' });
  if (g.status !== 201) throw new Error(`granting QA models failed: ${g.status} ${JSON.stringify(g.body)}`);
  return g.body.allowance;
}

/** One product, identified by UPC alone (no upload needed). */
const product = (name) => ({ brief: { productTypeId: 'base-cabinet', kind: 'base', variant: 'door-drawer', name, upc: '036000291452', notes: 'QA', referenceFileIds: [] } });

/** Sends a request as the QA contractor through the API. */
async function sendRequest(api, n, name = 'QA Harbor Base (Demo)') {
  const r = await api.as('contractor').post('/api/orders', { target: 'contractor', items: Array.from({ length: n }, (_, i) => product(`${name} ${i + 1}`)) });
  if (r.status !== 201) throw new Error(`sending a QA request failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.order.id;
}

/** Uses up every model the QA contractor has left; returns the requests made, to withdraw later. */
async function useAllModels(api) {
  const a = await allowanceOf(api);
  return a.left > 0 ? [await sendRequest(api, a.left, 'QA allowance filler (Demo)')] : [];
}

/** Withdraws requests made by a route (back to the allowance), so later routes start where they were. */
async function withdraw(api, ids) {
  for (const id of ids) await api.as('contractor').post(`/api/orders/${id}/cancel`, {});
}

/** A free user's kitchen, to try an export from. */
async function newKitchen(me, name) {
  const r = await me.post('/api/projects', {
    name,
    doc: {
      name,
      room: { widthIn: 200, lengthIn: 156, ceilingIn: 108 },
      surfaces: { cabinetFinishId: 'warm-white', doorStyle: 'shaker', hardwareId: 'brass', countertopId: 'calacatta', backsplashId: 'zellige-white', flooringId: 'herringbone', paintId: 'chalk' },
      items: [{ id: 'qa-base', productId: 'base', x: 48, y: 12, rotation: 0, finishIndex: 0 }],
    },
  });
  if (r.status !== 201) throw new Error(`creating "${name}" failed (${r.status}): ${r.body?.error ?? r.text}`);
  return { path: `#/k/${r.body.project.id}`, projectId: r.body.project.id };
}

/** Opens the editor's Export menu and picks `label`. */
async function exportItem(h, label) {
  const compact = await h.evaluate(() => !!document.querySelector('.export-btn'));
  await h.click(compact ? '.export-btn' : '.topbar .menu-wrap > .btn.primary');
  await h.waitFor('.topbar .menu[role="menu"]');
  const ok = await h.evaluate((l) => {
    const b = [...document.querySelectorAll('.topbar .menu [role="menuitem"]')].find((x) => x.querySelector('b')?.textContent.trim() === l);
    if (b) b.setAttribute('data-qa-item', l);
    return !!b;
  }, label);
  if (!ok) throw new Error(`no "${label}" item in the Export menu`);
  await h.click(`[data-qa-item="${label}"]`);
}

/** The text of the account menu once opened. */
const openMenu = `(async () => {
  document.querySelector('.menu-wrap .avatar')?.click();
  for (let i = 0; i < 30 && !document.querySelector('.menu-wrap .menu'); i++) await new Promise((r) => setTimeout(r, 100));
  return document.querySelector('.menu-wrap .menu')?.textContent ?? null;
})()`;

/** The pricing page and the landing page say nothing about the one-kitchen unlock or its price. */
const NO_UNLOCK = `(() => {
  const t = document.querySelector('main')?.textContent ?? '';
  return ['Kitchen unlock', 'unlock cover', '$5 ', '$5.', '$5)', '$5 CAD', 'Model pack', '$129', '$40'].filter((x) => t.includes(x));
})()`;

export default [
  // ── Pricing and landing: three plans, CAD, no unlock ──────────────────
  {
    name: 'pricing-plans',
    path: '#/pricing',
    as: 'anon',
    viewport: DESKTOP,
    waitFor: ['.mk-plans .mk-plan', '.mk-pack'],
    expectText: ['Free', 'Unlimited', 'Contractor', '$15', '$99', 'CAD a month', '3 custom 3D models a month, made by our studio', 'Prices are in Canadian dollars'],
    check: async ({ evaluate, shot }) => {
      const plans = await evaluate(`[...document.querySelectorAll('.mk-plans .mk-plan h3')].map((x) => x.textContent.trim())`);
      if (JSON.stringify(plans) !== JSON.stringify(['Free', 'Unlimited', 'Contractor'])) throw new Error(`the plan cards are ${JSON.stringify(plans)}`);
      const free = await evaluate(`document.querySelector('.mk-plans .mk-plan').textContent`);
      if (/\$\d+(?!\d)/.test(free.replace('$0', ''))) throw new Error(`the Free card quotes an export price: ${free}`);
      const bad = await evaluate(NO_UNLOCK);
      if (bad.length) throw new Error(`the pricing page still says ${JSON.stringify(bad)}`);
      await shot('plans');
      await evaluate(`document.getElementById('contractor').scrollIntoView({ block: 'start' })`);
      if (!(await evaluate(bodyHas('custom 3D models a month, made by our studio and delivered straight into your catalog')))) throw new Error('the Contractor program does not list the included models');
      await shot('contractor');
      await evaluate(`document.getElementById('faq').scrollIntoView({ block: 'start' })`);
      await shot('faq');
    },
  },
  {
    name: 'pricing-plans-phone',
    path: '#/pricing',
    as: 'anon',
    viewport: PHONE,
    waitFor: ['.mk-plans .mk-plan'],
    expectText: ['$99', 'CAD a month'],
    check: async ({ evaluate, shot }) => {
      if (await evaluate(SIDEWAYS)) throw new Error('the pricing page scrolls sideways on a phone');
      await evaluate(`document.querySelectorAll('.mk-plans .mk-plan')[2].scrollIntoView({ block: 'start' })`);
      await shot('contractor-card');
    },
  },
  {
    name: 'landing-no-unlock',
    path: '#/',
    as: 'anon',
    viewport: DESKTOP,
    waitFor: ['.mk-band'],
    expectText: ['$99 CAD/month', '3 custom 3D models a month, made by our studio'],
    check: async ({ evaluate }) => {
      const bad = await evaluate(NO_UNLOCK);
      if (bad.length) throw new Error(`the landing page still says ${JSON.stringify(bad)}`);
    },
  },

  // ── The export dialog is where a free user meets the unlock ───────────
  {
    name: 'export-offers-unlock',
    as: 'fresh',
    viewport: DESKTOP,
    setup: async ({ me }) => newKitchen(me, 'QA Pricing Kitchen'),
    waitFor: ['.topbar', '.plan-view canvas'],
    check: async (h) => {
      await exportItem(h, 'Floor plan');
      await h.waitFor('.modal.unlock[role="dialog"]');
      await h.waitForText(['Unlock this kitchen - $5 CAD once', 'Unlimited - $15 CAD/month']);
      await h.sleep(300);
      await h.shot('dialog');
    },
  },
  {
    name: 'export-offers-unlock-phone',
    as: 'fresh',
    viewport: PHONE,
    setup: async ({ me }) => newKitchen(me, 'QA Pricing Phone'),
    waitFor: ['.topbar', '.plan-view canvas'],
    check: async (h) => {
      await exportItem(h, 'Floor plan');
      await h.waitFor('.modal.unlock[role="dialog"]');
      await h.waitForText(['Unlock this kitchen - $5 CAD once', 'Unlimited - $15 CAD/month']);
      if (await h.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw new Error('the export dialog scrolls sideways on a phone');
      await h.sleep(300);
      await h.shot('dialog');
    },
  },
  {
    // Billing doesn't sell the unlock either; a non-contractor with earlier custom-model orders is
    // pointed to them (they have no menu entry).
    name: 'billing-free-user',
    path: '#/account/billing',
    as: 'customer',
    viewport: DESKTOP,
    waitFor: ['.billing-plans'],
    expectText: ['Unlimited', 'Contractor', 'CAD / month', 'see your custom model orders'],
    check: async ({ evaluate, shot }) => {
      const t = await evaluate(`document.querySelector('.billing-main').textContent`);
      for (const bad of ['Kitchen unlock', '$5 ', '$5 CAD']) if (t.includes(bad)) throw new Error(`Billing still says "${bad}"`);
      await shot('page');
    },
  },

  // ── Make custom models: the Contractor plan's allowance ───────────────
  {
    // The QA contractor fills in one product, sends it (no payment), sees it submitted and
    // included, then withdraws it before the studio starts: the model goes back.
    name: 'models-send-and-withdraw',
    path: '#/orders/new?target=contractor',
    as: 'contractor',
    setup: async ({ api }) => ({ before: (await ensureModels(api, 1)).left }),
    viewport: DESKTOP,
    waitFor: ['.ord-product.open', '.ord-allowance'],
    expectText: ['models left this month', 'Included in your plan'],
    check: async (h) => {
      const { evaluate, shot, send, api, data } = h;
      await evaluate(`(() => {
        const s = document.querySelector('#ord-product-0 select');
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, 'base-cabinet');
        s.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
      for (const [sel, text] of [
        ['#ord-product-0 input[maxlength="80"]', `QA Withdraw Base ${Date.now().toString(36)} (Demo)`],
        ['#ord-p0-upc', '036000291452'],
      ]) {
        await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.scrollIntoView({ block: 'center' }); el.focus(); el.select?.(); })()`);
        await send('Input.insertText', { text });
      }
      if (!(await evaluate(waitFor(bodyHas('✓ UPC-A 0 36000 29145 2'))))) throw new Error('the UPC was not confirmed');
      if (!(await evaluate(click('Review 1 product')))) throw new Error('no review button');
      if (!(await evaluate(waitFor(bodyHas('Send 1 product to the studio'))))) throw new Error('no Send button');
      await shot('review');
      await evaluate(click('Send 1 product to the studio'));
      if (!(await evaluate(waitFor(`location.hash.startsWith('#/orders/o_') && ${bodyHas('Submitted · in the queue')}`, 8000)))) throw new Error('sending did not open the submitted request');
      if (!(await evaluate(waitFor(`${bodyHas('Included')} && ${bodyHas('Withdraw request')} && ${bodyHas('Nothing to pay')}`)))) throw new Error('the request page does not say it is included, or offer Withdraw');
      if (await evaluate(`[...document.querySelectorAll('button')].some((b) => /^Pay /.test(b.textContent.trim()))`)) throw new Error('a plan request offers to pay');
      const mid = await allowanceOf(api);
      if (mid.left !== data.before - 1) throw new Error(`after sending, ${mid.left} left (expected ${data.before - 1})`);
      await shot('submitted');
      await evaluate(click('Withdraw request', '.ord-actions'));
      if (!(await evaluate(waitFor(`!!document.querySelector('.modal') && ${bodyHas('back to this month’s allowance')}`)))) throw new Error('no withdraw confirmation');
      await evaluate(click('Withdraw request', '.modal'));
      if (!(await evaluate(waitFor(bodyHas('Cancelled before work started'), 8000)))) throw new Error('the request was not withdrawn');
      const after = await allowanceOf(api);
      if (after.left !== data.before) throw new Error(`after withdrawing, ${after.left} left (expected ${data.before})`);
    },
  },
  {
    // Every model used: the form says when the allowance resets, offers Need more?, and can't be
    // sent (it can still be prepared). The requests made for it are withdrawn afterwards.
    name: 'models-none-left',
    path: '#/orders/new?target=contractor',
    as: 'contractor',
    setup: async ({ api }) => ({ ids: await useAllModels(api) }),
    viewport: DESKTOP,
    waitFor: ['.ord-product.open', '.ord-allowance'],
    expectText: ['No models left this month - resets', 'Need more?'],
    check: async (h) => {
      const { evaluate, shot, api, data } = h;
      try {
        if (!(await evaluate(waitFor(bodyHas('That’s every model left this month'))))) throw new Error('the form does not say every model is used');
        // The plan box says what is left now (not "after this request"), the reset once, and Need more.
        const aside = await evaluate(`document.querySelector('.ord-quote')?.textContent ?? ''`);
        if (/after this request/.test(aside) || !/Left this month/.test(aside) || !/Need more\?/.test(aside)) throw new Error(`the plan box reads: ${aside}`);
        if ((aside.match(/resets on/g) ?? []).length !== 1) throw new Error(`the plan box gives the reset date ${(aside.match(/resets on/g) ?? []).length} times: ${aside}`);
        await shot('none-left');
        const list = await api.as('contractor').get('/api/orders');
        if (list.body?.allowance?.left !== 0) throw new Error(`the list says ${list.body?.allowance?.left} left`);
        // The server refuses anything more, with the reset date.
        const r = await api.as('contractor').post('/api/orders', { target: 'contractor', items: [product('QA one too many (Demo)')] });
        if (r.status !== 409 || !/resets on/.test(r.body?.error ?? '')) throw new Error(`one more request answered ${r.status} ${JSON.stringify(r.body)}`);
      } finally {
        await withdraw(api, data.ids);
      }
    },
  },
  {
    name: 'models-none-left-phone',
    path: '#/orders',
    as: 'contractor',
    setup: async ({ api }) => ({ ids: await useAllModels(api) }),
    viewport: PHONE,
    waitFor: ['.ord-allowance-bar'],
    expectText: ['No models left this month - resets', 'Make a custom model', 'Need more?'],
    check: async (h) => {
      const { evaluate, shot, api, data } = h;
      try {
        if (await evaluate(SIDEWAYS)) throw new Error('the custom models page scrolls sideways on a phone');
        // Requests withdrawn by the routes before this one: "Not counted", at the row's right edge
        // (an empty due line used to push it to the middle).
        const bad = await evaluate(`(() => {
          const rows = [...document.querySelectorAll('.ord-row')].filter((r) => /Cancelled/.test(r.textContent));
          for (const r of rows) {
            const side = r.querySelector('.ord-row-side').getBoundingClientRect();
            const price = r.querySelector('.ord-row-meta').getBoundingClientRect();
            if (!/Not counted/.test(r.textContent) || /Included/.test(r.querySelector('.ord-row-meta').textContent)) return 'a cancelled request reads: ' + r.textContent;
            if (side.right - price.right > 2) return 'a cancelled request\\'s price sits ' + Math.round(side.right - price.right) + 'px in from the edge';
          }
          return '';
        })()`);
        if (bad) throw new Error(bad);
        await shot('list');
      } finally {
        await withdraw(api, data.ids);
      }
    },
  },
  {
    name: 'models-request-phone',
    path: '#/orders/new?target=contractor',
    as: 'contractor',
    setup: async ({ api }) => (await ensureModels(api, 1), {}),
    viewport: PHONE,
    fullPage: true,
    waitFor: ['.ord-product.open', '.ord-allowance'],
    expectText: ['models left this month', 'Where should the models go?'],
    check: async ({ evaluate }) => {
      if (await evaluate(SIDEWAYS)) throw new Error('the request form scrolls sideways on a phone');
    },
  },
  {
    // Not a contractor: no menu entry, and the request page says custom models come with the plan.
    name: 'models-not-contractor',
    path: '#/orders/new',
    as: 'customer',
    viewport: PHONE,
    waitFor: ['.ord-plan-note'],
    expectText: ['Custom 3D models come with the Contractor plan', 'See the Contractor plan'],
    check: async ({ evaluate, shot }) => {
      if (await evaluate(`!!document.querySelector('.ord-product')`)) throw new Error('a non-contractor gets the request form');
      if (await evaluate(SIDEWAYS)) throw new Error('the page scrolls sideways on a phone');
      await shot('note');
      const menu = await evaluate(openMenu);
      if (menu == null) throw new Error('the account menu did not open');
      if (menu.includes('Make custom models')) throw new Error('a non-contractor has Make custom models in the account menu');
    },
  },
  {
    name: 'models-menu-contractor',
    path: '#/',
    as: 'contractor',
    viewport: DESKTOP,
    waitFor: ['.menu-wrap .avatar'],
    check: async ({ evaluate, shot }) => {
      const menu = await evaluate(openMenu);
      if (!menu?.includes('Make custom models')) throw new Error(`the contractor's account menu has no Make custom models: ${menu}`);
      await shot('menu');
    },
  },

  // ── The studio and admins ─────────────────────────────────────────────
  {
    // The studio cancels a request it won't make, before starting: the model goes back.
    name: 'studio-cancels-plan-request',
    as: 'studio',
    viewport: DESKTOP,
    setup: async ({ api }) => {
      await ensureModels(api, 1);
      const name = `QA studio cancel ${Date.now().toString(36)} (Demo)`;
      const id = await sendRequest(api, 1, name);
      return { path: '#/admin/studio', id, name: `${name} 1`, left: (await allowanceOf(api)).left };
    },
    waitFor: ['.ord-queue'],
    expectText: ['Studio queue'],
    check: async (h) => {
      const { evaluate, shot, api, data } = h;
      if (!(await evaluate(click(data.name, '.ord-queue')))) throw new Error('the request is not in the queue');
      if (!(await evaluate(waitFor(`!!document.querySelector('.ord-drawer') && document.querySelector('.ord-drawer').textContent.includes('Cancel request…')`)))) throw new Error('the drawer offers no Cancel request');
      if (!(await evaluate(waitFor(`document.querySelector('.ord-drawer').textContent.includes('Contractor’s models')`)))) throw new Error('the drawer does not show the contractor’s models');
      if (await evaluate(`document.querySelector('.ord-drawer').textContent.includes('Refund')`)) throw new Error('a plan request offers a refund');
      await evaluate(click('Cancel request…', '.ord-drawer'));
      await evaluate(`(() => { const i = document.querySelector('.ord-drawer input[placeholder^="e.g. We can"]'); i.focus(); })()`);
      await h.send('Input.insertText', { text: 'QA: we can’t source this one.' });
      await shot('cancel');
      if (!(await evaluate(waitFor(`(() => { const b = [...document.querySelectorAll('.ord-drawer .btn.primary')].find((x) => x.textContent.trim() === 'Cancel request'); if (b) b.click(); return !!b; })()`)))) throw new Error('no Cancel request button');
      if (!(await evaluate(waitFor(`document.querySelector('.ord-drawer .ord-pill')?.textContent.includes('Cancelled')`, 8000)))) throw new Error('the request was not cancelled');
      const after = await allowanceOf(api);
      if (after.left !== data.left + 1) throw new Error(`after the studio cancelled, ${after.left} left (expected ${data.left + 1})`);
      const o = await api.as('contractor').get(`/api/orders/${data.id}`);
      if (!o.body?.events?.some((e) => /Cancelled by the studio: QA: we can’t source this one\./.test(e.note))) throw new Error('the contractor does not see the studio’s reason');
    },
  },
  {
    // An admin looks the QA contractor up and grants an extra model for this month (audit-logged).
    name: 'admin-grants-models',
    path: '#/admin/studio',
    as: 'admin',
    setup: async ({ api }) => ({ before: (await allowanceOf(api)).total }),
    viewport: DESKTOP,
    waitFor: ['.ord-grant-lookup'],
    expectText: ['Extra models for a contractor'],
    check: async (h) => {
      const { evaluate, shot, api, data } = h;
      await evaluate(`document.querySelector('.ord-grant-lookup summary').click()`);
      await evaluate(`document.querySelector('.ord-grant-lookup input[type=email]').focus()`);
      await h.send('Input.insertText', { text: CONTRACTOR_EMAIL });
      await evaluate(click('Look up', '.ord-grant-lookup'));
      if (!(await evaluate(waitFor(`/models? left this month - resets|No models left this month/.test(document.querySelector('.ord-grant-lookup').textContent)`)))) throw new Error('the lookup did not show the contractor’s allowance');
      await evaluate(`(() => { const i = document.querySelector('.ord-grant-lookup input[placeholder^="e.g. Launch"]'); i.focus(); })()`);
      await h.send('Input.insertText', { text: 'QA grant' });
      await evaluate(click('Grant', '.ord-grant-lookup'));
      if (!(await evaluate(waitFor(`document.querySelector('.ord-grant-lookup').textContent.includes('Granted 1 extra model')`, 8000)))) throw new Error('the grant was not confirmed');
      await shot('granted');
      const after = await allowanceOf(api);
      if (after.total !== data.before + 1) throw new Error(`after the grant the total is ${after.total} (expected ${data.before + 1})`);
      const audit = api.sql("SELECT COUNT(*) AS n FROM admin_audit WHERE action = 'model_grant' AND target_email = ?", CONTRACTOR_EMAIL)[0].n;
      if (!audit) throw new Error('the grant is not in the admin audit log');
    },
  },
];

// Zero-dependency headless browser driving for QA: launches the installed Edge (or Chrome)
// and talks the Chrome DevTools Protocol over Node's built-in WebSocket. No Playwright, no
// Puppeteer, nothing to install. scripts/qa.mjs builds on the exports below.
//
// As a command it takes one screenshot of a local page:
//
//   node scripts/qa-shot.mjs <url> <out.png> [--phone | --w=1440 --h=900] [--wait=3000] [--swiftshader] [--chrome]
//
// Only local pages (127.0.0.1, localhost, [::1]) are allowed. Every request a page makes to
// any other host is blocked before it leaves the machine (CDP Fetch interception, plus a
// host-resolver rule that makes every other host unresolvable), and is reported.
// Ports 8787 and 8790 are refused: other apps on this machine own them.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// 8787: another app. 8790: the live BluModel server. 8795: the blumodel.studio holding page.
export const FORBIDDEN_PORTS = Object.freeze([8787, 8790, 8795]);

const BROWSERS = {
  edge: ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', '/usr/bin/microsoft-edge'],
  chrome: [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
  ],
};

/** Viewport presets. `mobile` turns on touch emulation, a phone user agent and `(pointer: coarse)`. */
export const VIEWPORTS = Object.freeze({
  desktop: { w: 1440, h: 900, dpr: 1, mobile: false },
  laptop: { w: 1280, h: 800, dpr: 1, mobile: false },
  tablet: { w: 820, h: 1180, dpr: 2, mobile: true },
  phone: { w: 390, h: 844, dpr: 3, mobile: true },
  'phone-landscape': { w: 844, h: 390, dpr: 3, mobile: true },
});

const PHONE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** `{ w, h, dpr, mobile }` from a preset name or a partial object (desktop by default). */
export function resolveViewport(v) {
  if (!v) return { ...VIEWPORTS.desktop };
  if (typeof v === 'string') {
    if (!VIEWPORTS[v]) throw new Error(`Unknown viewport preset "${v}" (use ${Object.keys(VIEWPORTS).join(', ')} or { w, h }).`);
    return { ...VIEWPORTS[v] };
  }
  const base = v.preset ? resolveViewport(v.preset) : { ...VIEWPORTS.desktop };
  const w = v.w ?? v.width ?? base.w;
  const h = v.h ?? v.height ?? base.h;
  if (!(w > 0 && h > 0)) throw new Error(`Bad viewport ${JSON.stringify(v)}.`);
  const mobile = !!(v.mobile ?? v.touch ?? (v.preset ? base.mobile : false));
  return { w, h, dpr: v.dpr ?? (v.preset ? base.dpr : mobile ? 3 : 1), mobile };
}

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/** True for URLs that never leave this machine: loopback hosts and data/blob/about pages. */
export function isLocalUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (['data:', 'blob:', 'about:', 'devtools:'].includes(u.protocol)) return true;
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(u.protocol)) return false;
  return LOCAL_HOSTS.has(u.hostname) || u.hostname.endsWith('.localhost');
}

export function assertAllowedPort(port) {
  const p = Number(port);
  if (!Number.isInteger(p) || p <= 0 || p > 65535) throw new Error(`Bad port "${port}".`);
  if (FORBIDDEN_PORTS.includes(p)) throw new Error(`Port ${p} belongs to another app on this machine; pick another (packages use 8811–8829).`);
  return p;
}

/** Kills a process and its children by PID. Only ever called with PIDs this script started. */
export function killTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } else {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }
  }
}

/**
 * Kills the browser processes started with this exact throwaway profile (Windows only; elsewhere
 * the process group does it). A last resort for a browser whose PID could not be learned, e.g.
 * when its launcher exited before it said it was up. The profile dir is one this script made.
 */
function killByProfile(profile) {
  if (process.platform !== 'win32') return;
  const quoted = profile.replace(/'/g, "''");
  const script = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${quoted}') -and -not $_.CommandLine.Contains('--type=') } | ForEach-Object { taskkill /PID $_.ProcessId /T /F | Out-Null }`;
  spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'ignore', windowsHide: true });
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}

export function findBrowser({ chrome = false } = {}) {
  const fromEnv = process.env.BLUMODEL_QA_BROWSER;
  if (fromEnv) {
    if (!fs.existsSync(fromEnv)) throw new Error(`BLUMODEL_QA_BROWSER points at ${fromEnv}, which doesn't exist.`);
    return fromEnv;
  }
  const list = chrome ? BROWSERS.chrome : BROWSERS.edge;
  const exe = list.find((p) => fs.existsSync(p));
  if (!exe) throw new Error(`No ${chrome ? 'Chrome' : 'Edge'} found (looked in ${list.join(', ')}). Set BLUMODEL_QA_BROWSER to the browser's path.`);
  return exe;
}

/** One WebSocket to the browser; page sessions are multiplexed on it (flatten mode). */
export class Cdp {
  /** @param {WebSocket} ws */
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    /** @type {Map<number, { res: Function, rej: Function, method: string, timer: any }>} */
    this.pending = new Map();
    /** @type {Set<(method: string, params: any, sessionId?: string) => void>} */
    this.listeners = new Set();
    this.closed = false;
    ws.onmessage = (ev) => {
      let m;
      try {
        m = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8'));
      } catch {
        return;
      }
      if (m.id !== undefined) {
        const p = this.pending.get(m.id);
        if (!p) return;
        this.pending.delete(m.id);
        clearTimeout(p.timer);
        if (m.error) p.rej(new Error(`${p.method}: ${m.error.message}${m.error.data ? ` (${m.error.data})` : ''}`));
        else p.res(m.result);
        return;
      }
      for (const fn of this.listeners) {
        try {
          fn(m.method, m.params, m.sessionId);
        } catch (err) {
          console.error(`CDP listener for ${m.method} threw: ${err?.stack || err}`);
        }
      }
    };
    ws.onclose = () => {
      this.closed = true;
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.rej(new Error(`${p.method}: the browser connection closed`));
      }
      this.pending.clear();
    };
  }

  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = () => reject(new Error(`Could not connect to the browser at ${wsUrl}`));
    });
    return new Cdp(ws);
  }

  send(method, params = {}, sessionId, timeoutMs = 30_000) {
    if (this.closed) return Promise.reject(new Error(`${method}: the browser connection is closed`));
    const id = ++this.nextId;
    return new Promise((res, rej) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rej(new Error(`${method}: no answer from the browser in ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(id, { res, rej, method, timer });
      this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    });
  }

  /** Subscribes to events; returns the unsubscribe function. */
  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* already closed */
    }
  }
}

/**
 * Launches a headless browser with a throwaway profile.
 * @returns {Promise<{ cdp: Cdp, pid: number, exe: string, version: string, close: () => Promise<void> }>}
 */
export async function launchBrowser({ chrome = false, swiftshader = false, headless = true, log = () => {} } = {}) {
  const exe = findBrowser({ chrome });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'blumodel-qa-browser-'));
  const args = [
    ...(headless ? ['--headless=new'] : []),
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-sync',
    '--disable-default-apps',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-domain-reliability',
    '--disable-client-side-phishing-detection',
    '--no-pings',
    '--mute-audio',
    '--hide-crash-restore-bubble',
    '--disable-features=Translate,OptimizationHints,MediaRouter,AutofillServerCommunication,msSmartScreenProtection,msEdgeShoppingAssistant,msEdgeCollections,EdgeShoppingAssistantEnabled',
    // Nothing but loopback resolves, and no proxy is used, so not even the browser itself
    // can reach another host. Page requests are also blocked one by one (Fetch domain).
    '--no-proxy-server',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost',
    `--user-data-dir=${profile}`,
    '--remote-debugging-port=0',
    '--window-size=1440,900',
    ...(swiftshader ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : []),
    'about:blank',
  ];
  const proc = spawn(exe, args, { stdio: 'ignore', windowsHide: true, detached: process.platform !== 'win32' });
  let exited = false;
  let exitCode = null;
  proc.on('exit', (code) => {
    exited = true;
    exitCode = code;
  });
  /** The real browser process. msedge.exe can be a launcher that starts the browser and exits. */
  let browserPid = null;
  const cleanupProfile = async () => {
    for (let i = 0; i < 10; i++) {
      try {
        fs.rmSync(profile, { recursive: true, force: true });
        return;
      } catch {
        await sleep(200);
      }
    }
  };
  const kill = async () => {
    if (browserPid) killTree(browserPid);
    killTree(proc.pid);
    if (!browserPid) killByProfile(profile);
    await cleanupProfile();
  };
  try {
    let port = null;
    // An installed Edge newer than the msedge.exe stub (it updates itself) makes the stub start the
    // real browser and exit 0 within milliseconds, so an exit is only fatal when it is a failure
    // code. A browser that never writes DevToolsActivePort is caught by the 15 s limit below.
    for (let i = 0; i < 150 && !port; i++) {
      if (exited && exitCode) throw new Error(`${path.basename(exe)} exited with code ${exitCode} before exposing a DevTools port.`);
      try {
        port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0].trim();
      } catch {
        await sleep(100);
      }
    }
    if (!port) throw new Error('The browser did not expose a DevTools port within 15 s.');
    const info = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    const cdp = await Cdp.connect(info.webSocketDebuggerUrl);
    try {
      const { processInfo } = await cdp.send('SystemInfo.getProcessInfo', {}, undefined, 5000);
      browserPid = processInfo?.find((p) => p.type === 'browser')?.id ?? null;
    } catch {
      /* falls back to the launcher's PID and the profile sweep */
    }
    log(`browser: ${info.Browser} (pid ${browserPid ?? proc.pid})`);
    return {
      cdp,
      pid: browserPid ?? proc.pid,
      exe,
      version: info.Browser,
      async close() {
        try {
          await cdp.send('Browser.close', {}, undefined, 3000);
        } catch {
          /* killed below anyway */
        }
        cdp.close();
        for (let i = 0; i < 20 && !(exited && !(browserPid && isAlive(browserPid))); i++) await sleep(100);
        await kill();
      },
    };
  } catch (err) {
    await kill();
    throw err;
  }
}

/**
 * A fresh page in its own browser context (separate cookies and storage), with console,
 * exception and network capture, and every non-local request blocked.
 */
export async function openPage(cdp, { viewport, blockExternal = true } = {}) {
  const vp = resolveViewport(viewport);
  const { browserContextId } = await cdp.send('Target.createBrowserContext', { disposeOnDetach: true });
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params = {}, timeoutMs) => cdp.send(method, params, sessionId, timeoutMs);

  const events = {
    console: /** @type {{ type: string, text: string }[]} */ ([]),
    exceptions: /** @type {string[]} */ ([]),
    log: /** @type {{ level: string, source: string, text: string, url?: string }[]} */ ([]),
    external: /** @type {string[]} */ ([]),
    responses: /** @type {{ url: string, status: number, method?: string }[]} */ ([]),
    failed: /** @type {{ url: string, error: string, canceled: boolean }[]} */ ([]),
  };
  const requests = new Map();
  const waiters = new Set();
  const external = (url) => {
    if (!events.external.includes(url)) events.external.push(url);
  };

  const off = cdp.on((method, p, sid) => {
    if (sid !== sessionId) return;
    switch (method) {
      case 'Runtime.consoleAPICalled': {
        const text = (p.args || [])
          .map((a) => (a.value !== undefined ? (typeof a.value === 'string' ? a.value : JSON.stringify(a.value)) : a.description ?? a.type))
          .join(' ');
        events.console.push({ type: p.type, text: text.slice(0, 2000) });
        break;
      }
      case 'Runtime.exceptionThrown': {
        const d = p.exceptionDetails || {};
        events.exceptions.push(String(d.exception?.description ?? d.text ?? 'exception').slice(0, 2000));
        break;
      }
      case 'Log.entryAdded':
        events.log.push({ level: p.entry.level, source: p.entry.source, text: String(p.entry.text).slice(0, 2000), url: p.entry.url });
        break;
      case 'Fetch.requestPaused': {
        const url = p.request.url;
        if (!blockExternal || isLocalUrl(url)) {
          send('Fetch.continueRequest', { requestId: p.requestId }).catch(() => {});
        } else {
          external(url);
          send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'BlockedByClient' }).catch(() => {});
        }
        break;
      }
      case 'Network.requestWillBeSent':
        requests.set(p.requestId, { url: p.request.url, method: p.request.method });
        if (!isLocalUrl(p.request.url)) external(p.request.url);
        break;
      case 'Network.responseReceived': {
        const r = requests.get(p.requestId);
        events.responses.push({ url: p.response.url, status: p.response.status, method: r?.method });
        break;
      }
      case 'Network.loadingFailed': {
        const r = requests.get(p.requestId);
        if (r) events.failed.push({ url: r.url, error: p.errorText, canceled: !!p.canceled, blocked: p.blockedReason });
        break;
      }
    }
    for (const w of waiters) w(method, p);
  });

  /** Resolves when `method` fires on this page (or rejects after `timeoutMs`). */
  const waitEvent = (method, timeoutMs = 20_000) =>
    new Promise((resolve, reject) => {
      const fn = (m, p) => {
        if (m !== method) return;
        waiters.delete(fn);
        clearTimeout(timer);
        resolve(p);
      };
      const timer = setTimeout(() => {
        waiters.delete(fn);
        reject(new Error(`timed out after ${timeoutMs} ms waiting for ${method}`));
      }, timeoutMs);
      waiters.add(fn);
    });

  if (blockExternal) await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  await Promise.all([send('Page.enable'), send('Runtime.enable'), send('Network.enable'), send('Log.enable')]);
  await send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: vp.dpr, mobile: vp.mobile });
  if (vp.mobile) {
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await send('Emulation.setUserAgentOverride', { userAgent: PHONE_UA, platform: 'Android' });
  }

  /** Evaluates an expression, or a function with JSON-serialisable arguments, in the page. */
  const evaluate = async (exprOrFn, ...args) => {
    const expression = typeof exprOrFn === 'function' ? `(${exprOrFn})(...${JSON.stringify(args)})` : String(exprOrFn);
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error(`evaluate failed: ${d.exception?.description ?? d.text}`);
    }
    return r.result?.value;
  };

  return {
    sessionId,
    targetId,
    browserContextId,
    viewport: vp,
    events,
    send,
    evaluate,
    waitEvent,
    /** Navigates and waits for the load event. */
    async goto(url, timeoutMs = 20_000) {
      const loaded = waitEvent('Page.loadEventFired', timeoutMs);
      const r = await send('Page.navigate', { url });
      if (r.errorText) {
        loaded.catch(() => {});
        throw new Error(`navigation to ${url} failed: ${r.errorText}`);
      }
      await loaded;
    },
    /** PNG bytes of the viewport, or of the whole page with `fullPage`. */
    async screenshot({ fullPage = false } = {}) {
      const params = { format: 'png' };
      if (fullPage) {
        const m = await send('Page.getLayoutMetrics');
        const size = m.cssContentSize || m.contentSize;
        params.captureBeyondViewport = true;
        params.clip = { x: 0, y: 0, width: Math.ceil(size.width), height: Math.min(Math.ceil(size.height), 12_000), scale: 1 };
      }
      const shot = await send('Page.captureScreenshot', params, 60_000);
      return Buffer.from(shot.data, 'base64');
    },
    async close() {
      off();
      waiters.clear();
      try {
        await cdp.send('Target.closeTarget', { targetId }, undefined, 5000);
      } catch {
        /* the browser may already be gone */
      }
      try {
        await cdp.send('Target.disposeBrowserContext', { browserContextId }, undefined, 5000);
      } catch {
        /* disposed on detach */
      }
    },
  };
}

// ─── CLI: one screenshot ──────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const flag = (n, d) => {
    const a = args.find((x) => x.startsWith(`--${n}=`));
    return a ? a.slice(n.length + 3) : d;
  };
  const [url, out] = args.filter((a) => !a.startsWith('--'));
  if (!url || !out) {
    console.error('Usage: node scripts/qa-shot.mjs <http://127.0.0.1:<port>/…> <out.png> [--phone | --w=1440 --h=900] [--wait=3000] [--full] [--swiftshader] [--chrome]');
    return 2;
  }
  if (!isLocalUrl(url) || !/^https?:/.test(url)) {
    console.error(`Only local pages can be shot (127.0.0.1, localhost): ${url}`);
    return 2;
  }
  const u = new URL(url);
  assertAllowedPort(u.port || (u.protocol === 'https:' ? 443 : 80));
  const viewport = args.includes('--phone') ? 'phone' : { w: +flag('w', 1440), h: +flag('h', 900), dpr: +flag('dpr', 1) };
  const t0 = Date.now();
  const browser = await launchBrowser({ chrome: args.includes('--chrome'), swiftshader: args.includes('--swiftshader') });
  const stop = () => {
    killTree(browser.pid);
    process.exit(130);
  };
  process.once('SIGINT', stop);
  try {
    const page = await openPage(browser.cdp, { viewport });
    await page.goto(url);
    await sleep(+flag('wait', 3000));
    const info = await page.evaluate(() => {
      const g = document.createElement('canvas').getContext('webgl2');
      const e = g && g.getExtension('WEBGL_debug_renderer_info');
      return { href: location.href, title: document.title, canvases: [...document.querySelectorAll('canvas')].map((c) => `${c.width}x${c.height}`), renderer: e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : null };
    });
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, await page.screenshot({ fullPage: args.includes('--full') }));
    const ev = page.events;
    const logs = [
      ...ev.console.filter((c) => c.type === 'error' || c.type === 'warning').map((c) => `${c.type}: ${c.text}`),
      ...ev.exceptions.map((e) => `exception: ${e}`),
      ...ev.log.filter((l) => l.level === 'error').map((l) => `log ${l.source}: ${l.text}`),
    ];
    console.log(JSON.stringify({ ms: Date.now() - t0, browser: browser.version, ...info, blockedExternal: ev.external, logs }, null, 1));
    await page.close();
    return logs.length || ev.external.length ? 1 : 0;
  } finally {
    process.off('SIGINT', stop);
    await browser.close();
  }
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(err?.stack || String(err));
      process.exit(1);
    },
  );
}

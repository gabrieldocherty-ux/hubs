// A signed-in device's label for Account settings > Security ("Edge on Windows"). Only the browser
// and system names are kept with the session, never the full User-Agent string or an address: the
// list exists so a person can recognise their own devices, and that is all it needs.

/** @param {string | undefined} ua */
export function browserOf(ua = '') {
  const s = String(ua);
  if (/\bEdg(e|A|iOS)?\//.test(s)) return 'Edge';
  if (/\bOPR\/|\bOpera\b/.test(s)) return 'Opera';
  if (/\bSamsungBrowser\//.test(s)) return 'Samsung Internet';
  if (/\bFirefox\/|\bFxiOS\//.test(s)) return 'Firefox';
  if (/\bChrome\/|\bCriOS\/|\bChromium\//.test(s)) return 'Chrome';
  if (/\bSafari\//.test(s) && /\bVersion\//.test(s)) return 'Safari';
  return '';
}

/** @param {string | undefined} ua */
export function osOf(ua = '') {
  const s = String(ua);
  if (/\b(iPhone|iPod)\b/.test(s)) return 'iPhone';
  if (/\biPad\b/.test(s)) return 'iPad';
  if (/\bAndroid\b/.test(s)) return 'Android';
  if (/\bCrOS\b/.test(s)) return 'ChromeOS';
  if (/\bWindows\b/.test(s)) return 'Windows';
  if (/\bMac OS X\b|\bMacintosh\b/.test(s)) return 'macOS';
  if (/\bLinux\b/.test(s)) return 'Linux';
  return '';
}

/** `{ browser, os }` from a request's User-Agent; empty strings when it doesn't say. */
export function deviceOf(req) {
  const ua = String(req?.headers?.['user-agent'] ?? '').slice(0, 512);
  return { browser: browserOf(ua), os: osOf(ua) };
}

/** "Edge on Windows", "Safari", "a device". */
export function deviceLabel({ browser, os }) {
  if (browser && os) return `${browser} on ${os}`;
  return browser || os || 'an unknown device';
}

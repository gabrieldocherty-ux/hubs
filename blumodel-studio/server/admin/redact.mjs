// Redaction for anything the admin panel shows from a log or an error: keys, secrets, tokens and
// session or reset values never reach the browser, even when a line happened to contain one.
// Deliberately broad: a false positive costs a few characters of a log line, a false negative
// leaks a credential.

const RULES = [
  // Provider keys by their well-known prefixes.
  [/\b(sk|rk|pk)_(live|test)_[A-Za-z0-9]+/g, '$1_$2_[redacted]'],
  [/\bwhsec_[A-Za-z0-9]+/g, 'whsec_[redacted]'],
  [/\bre_[A-Za-z0-9_]{8,}/g, 're_[redacted]'],
  [/\bsk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-[redacted]'],
  // Authorization headers and bearer tokens.
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [redacted]'],
  // key=value / "key": "value" pairs whose name says secret.
  [/((?:password|passwd|secret|token|api[_-]?key|apikey|authorization|cookie|signature|session|reset)[A-Za-z_-]*["']?\s*[:=]\s*["']?)[^\s"',;&]+/gi, '$1[redacted]'],
  // Query-string values for the same names.
  [/([?&](?:token|key|reset|session|sig|signature)=)[^&\s]+/gi, '$1[redacted]'],
  // Long opaque runs: share tokens, session tokens, hashes, JWT parts.
  [/[A-Za-z0-9_-]{32,}/g, '[redacted]'],
];

/** `s` with anything token-like replaced, cut to `max` characters. */
export function redact(s, max = 500) {
  let out = String(s ?? '');
  for (const [re, to] of RULES) out = out.replace(re, to);
  return out.length > max ? out.slice(0, max) + '…' : out;
}

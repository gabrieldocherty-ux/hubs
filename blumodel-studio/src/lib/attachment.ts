/**
 * The filename from `Content-Disposition: attachment; filename="…"` (or `filename*=UTF-8''…`),
 * made safe to save: path separators, control characters and the characters Windows refuses
 * become "-", and a leading dot or dash is dropped. Falls back when the header is missing,
 * malformed or names nothing usable.
 */
export function attachmentName(header: string | null, fallback: string): string {
  const m = header ? /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header) : null;
  let raw = m ? m[1]! : '';
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // A stray "%" in a plain filename: keep it as written.
  }
  const name = raw
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
    .replace(/^[.\s-]+/, '')
    .trim();
  return name || fallback;
}

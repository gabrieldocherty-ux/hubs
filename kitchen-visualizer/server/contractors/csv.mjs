// Supplier price lists in, price book out (PLANS_AND_CONTRACTORS §4.4). A small RFC 4180
// reader: quoted fields, doubled quotes, commas, semicolons or tabs, CRLF or LF, a BOM.

/** Rows of cells. Detects the delimiter from the first line (comma, semicolon or tab). */
export function parseCsv(text) {
  const src = String(text ?? '').replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let inQ = false;
  for (const ch of firstLine) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ && ch in counts) counts[ch]++;
  }
  const delim = counts[';'] > counts[','] && counts[';'] >= counts['\t'] ? ';' : counts['\t'] > counts[','] ? '\t' : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delim) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const HEADERS = {
  sku: ['sku', 'item', 'item number', 'item #', 'code', 'product code', 'part', 'part number', 'part #', 'model', 'model number'],
  name: ['name', 'description', 'product', 'product name', 'item name'],
  width: ['width', 'w', 'size', 'width (in)', 'width in'],
  cost: ['cost', 'your cost', 'unit cost', 'net', 'net price', 'dealer', 'dealer price', 'dealer cost', 'price', 'wholesale'],
};
const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Finds the columns. With a header row (any recognised name), uses it; otherwise assumes
 * SKU, name, width, cost. Returns `{ columns, start }` (start = first data row index).
 */
export function columnsOf(rows) {
  const head = (rows[0] ?? []).map(norm);
  const find = (names) => head.findIndex((h) => names.includes(h));
  const cols = { sku: find(HEADERS.sku), name: find(HEADERS.name), width: find(HEADERS.width), cost: find(HEADERS.cost) };
  if (cols.sku >= 0 || cols.cost >= 0) return { columns: cols, start: 1, header: true };
  return { columns: { sku: 0, name: 1, width: 2, cost: 3 }, start: 0, header: false };
}

/** "$1,234.50" → 123450 (cents); null when it isn't a price. */
export function parseMoney(v) {
  const s = String(v ?? '').trim().replace(/[$\s]/g, '').replace(/,(?=\d{3}(\D|$))/g, '');
  if (!/^\d+(\.\d{1,4})?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n <= 1_000_000 ? Math.round(n * 100) : null;
}

/** "24", 24″, 24in → 24; '' → null; anything else → NaN. */
export function parseWidth(v) {
  const s = String(v ?? '').trim().replace(/(″|"|in(ches)?|”)$/i, '').trim();
  if (!s) return null;
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return NaN;
  const n = Number(s);
  return n >= 1 && n <= 240 ? n : NaN;
}

/** CSV-injection guard plus quoting, for the price book export. */
export function csvCell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

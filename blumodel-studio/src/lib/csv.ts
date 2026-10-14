import type { DesignDoc } from '../types';
import type { Estimate } from './estimate';
import { csvEscape } from './exporters';
import { feetInches } from './format';

export const PLACEHOLDER_PRICES_NOTE = 'Brand names and prices are placeholders for illustration.';
export const VISUALIZER_DISCLAIMER =
  'Mise is a visualizer. Layouts, dimensions and estimates are for planning conversations, not construction or installation drawings. Verify everything with a professional.';

/** CSV-injection guard: a cell that a spreadsheet would treat as a formula gets a leading quote. */
function safeCell(v: string | number): string | number {
  return typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

export function estimateCsv(doc: DesignDoc, est: Estimate): string {
  const rows: (string | number)[][] = [
    [`${doc.name} — ${feetInches(doc.room.widthIn)} x ${feetInches(doc.room.lengthIn)}`],
    ['Group', 'Item', 'Detail', 'SKU', 'Qty', 'Unit', 'Unit price', 'Total', 'Buy link'],
    ...est.lines.map((l) => [l.group, l.label, l.sub, l.sku ?? '', l.qty, l.unit, l.unitPrice, l.total, l.buyUrl ?? '']),
    [],
    ['', '', '', '', '', '', 'Estimated total', est.total],
    ...(est.hasBuiltin ? [[PLACEHOLDER_PRICES_NOTE]] : []),
    [VISUALIZER_DISCLAIMER],
  ];
  return rows.map((r) => r.map((v) => csvEscape(safeCell(v))).join(',')).join('\n');
}

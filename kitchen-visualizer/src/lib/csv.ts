import type { DesignDoc } from '../types';
import type { Estimate } from './estimate';
import { csvEscape } from './exporters';
import { feetInches } from './format';

export function estimateCsv(doc: DesignDoc, est: Estimate): string {
  const rows: (string | number)[][] = [
    [`${doc.name} — ${feetInches(doc.room.widthIn)} x ${feetInches(doc.room.lengthIn)}`],
    ['Group', 'Item', 'Detail', 'Qty', 'Unit', 'Unit price', 'Total'],
    ...est.lines.map((l) => [l.group, l.label, l.sub, l.qty, l.unit, l.unitPrice, l.total]),
    [],
    ['', '', '', '', '', 'Estimated total', est.total],
    ['Brand names and prices are placeholders for illustration.'],
  ];
  return rows.map((r) => r.map(csvEscape).join(',')).join('\n');
}

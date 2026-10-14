import { memo } from 'react';
import type { DesignDoc } from '../types';
import { resolveAll } from '../lib/geometry';
import { hasCountertop, isOpening } from '../data/catalog';
import { COUNTERTOPS, FLOORING, byId } from '../data/finishes';
import { resolveFinish } from '../lib/finish';
import { shade } from '../lib/color';

const INK = '#2a2622';

/** A small, dependency-free plan drawing of a saved kitchen for cards and pickers. */
export const MiniPlan = memo(function MiniPlan({ doc, className, highlight }: { doc: DesignDoc; className?: string; highlight?: boolean }) {
  const { room, surfaces } = doc;
  const W = room.widthIn;
  const L = room.lengthIn;
  const T = Math.max(4, Math.max(W, L) * 0.025);
  const floor = byId(FLOORING, surfaces.flooringId).hex;
  const counter = byId(COUNTERTOPS, surfaces.countertopId).hex;
  const all = resolveAll(doc.items).sort((a, b) => a.z0 - b.z0);
  const pad = T + 4;

  return (
    <svg className={className} viewBox={`${-pad} ${-pad} ${W + pad * 2} ${L + pad * 2}`} preserveAspectRatio="xMidYMid meet" aria-hidden>
      <rect x={0} y={0} width={W} height={L} fill={shade(floor, 0.18)} />
      {all.map((r) => {
        if (isOpening(r.product)) return null;
        const b = r.box;
        const k = r.product.kind;
        const f = resolveFinish(r.item, r.product, surfaces);
        const overhead = r.z0 >= 48;
        const round = k === 'stool' || k === 'pendant' || (k === 'table' && r.product.variant === 'round') || k === 'plant';
        const fill = hasCountertop(r.product) ? counter : k === 'rug' ? shade(f.hex, 0.2) : f.hex;
        if (overhead && k !== 'pendant') {
          return <rect key={r.item.id} x={b.minX} y={b.minY} width={b.maxX - b.minX} height={b.maxY - b.minY} fill="none" stroke={INK} strokeWidth={0.8} strokeDasharray="3 2" opacity={0.45} />;
        }
        if (round) {
          const rad = Math.min(b.maxX - b.minX, b.maxY - b.minY) / 2;
          return <circle key={r.item.id} cx={(b.minX + b.maxX) / 2} cy={(b.minY + b.maxY) / 2} r={rad} fill={k === 'pendant' ? '#f2c66d' : fill} opacity={k === 'pendant' ? 0.85 : 1} stroke={INK} strokeWidth={0.8} />;
        }
        return (
          <g key={r.item.id}>
            <rect x={b.minX} y={b.minY} width={b.maxX - b.minX} height={b.maxY - b.minY} fill={fill} stroke={INK} strokeWidth={0.9} />
            {(k === 'range' || k === 'fridge' || k === 'tall' || k === 'oven-tower') && (
              <path d={`M${b.minX} ${b.minY} L${b.maxX} ${b.maxY} M${b.maxX} ${b.minY} L${b.minX} ${b.maxY}`} stroke={INK} strokeWidth={0.6} opacity={0.35} />
            )}
          </g>
        );
      })}
      <rect x={-T} y={-T} width={W + T * 2} height={L + T * 2} fill="none" stroke={highlight ? '#c2542d' : INK} strokeWidth={T} />
      {all
        .filter((r) => isOpening(r.product))
        .map((r) => {
          const b = r.box;
          const horiz = r.item.rotation === 0 || r.item.rotation === 180;
          return horiz ? (
            <rect key={r.item.id} x={b.minX} y={r.item.y < 1 ? -T : L} width={b.maxX - b.minX} height={T} fill={r.product.kind === 'window' ? '#cfe0ea' : '#f3eee5'} />
          ) : (
            <rect key={r.item.id} x={r.item.x < 1 ? -T : W} y={b.minY} width={T} height={b.maxY - b.minY} fill={r.product.kind === 'window' ? '#cfe0ea' : '#f3eee5'} />
          );
        })}
    </svg>
  );
});

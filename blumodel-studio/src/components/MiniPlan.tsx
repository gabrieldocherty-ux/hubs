import { memo } from 'react';
import type { DesignDoc } from '../types';
import { resolveAll } from '../lib/geometry';
import { floorSpaces, planSize, spaces } from '../lib/outline';
import { hasCountertop, isOpening } from '../data/catalog';
import { COUNTERTOPS, FLOORING, byId } from '../data/finishes';
import { resolveFinish } from '../lib/finish';
import { shade } from '../lib/color';

const INK = '#2a2622';
/** The walls and what an opening shows follow the theme (styles.css --plan-wall, --paper); the floor and the pieces keep their real colours and dark outlines. */
const WALL_STYLE = { stroke: 'var(--plan-wall)' };
const GAP_STYLE = { fill: 'var(--paper)' };

/** A small, dependency-free plan drawing of a saved kitchen for cards and pickers. */
export const MiniPlan = memo(function MiniPlan({ doc, className, highlight }: { doc: DesignDoc; className?: string; highlight?: boolean }) {
  const { room, surfaces } = doc;
  const { W, L } = planSize(room);
  const drawn = !!room.outline || !!room.extra?.length;
  const floors = floorSpaces(room);
  const outlines = floors.map((sp) => sp.pts);
  const zones = spaces(room).filter((sp) => sp.zone);
  const T = Math.max(4, Math.max(W, L) * 0.025);
  const floor = byId(FLOORING, surfaces.flooringId).hex;
  const counter = byId(COUNTERTOPS, surfaces.countertopId).hex;
  const all = resolveAll(doc.items).sort((a, b) => a.z0 - b.z0);
  const pad = T + 4;

  return (
    <svg className={className} viewBox={`${-pad} ${-pad} ${W + pad * 2} ${L + pad * 2}`} preserveAspectRatio="xMidYMid meet" aria-hidden>
      {drawn ? floors.map((sp, i) => <polygon key={i} points={sp.pts.map((q) => q.join(',')).join(' ')} fill={shade(sp.flooringId ? byId(FLOORING, sp.flooringId).hex : floor, 0.18)} />) : <rect x={0} y={0} width={W} height={L} fill={shade(floor, 0.18)} />}
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
        // Bathroom pieces in their plan symbols, in the item's own frame (back at -d/2).
        if (k === 'toilet' || k === 'tub' || k === 'shower' || k === 'vanity') {
          const { x, y, rotation } = r.item;
          const w = r.w;
          const d = r.product.depthIn;
          const white = '#f4f3ef';
          return (
            <g key={r.item.id} transform={`translate(${x} ${y}) rotate(${rotation})`}>
              {k === 'toilet' && (
                <>
                  <rect x={-w / 2 + 0.5} y={-d / 2} width={w - 1} height={8} rx={1.5} fill={white} stroke={INK} strokeWidth={0.9} />
                  <ellipse cx={0} cy={d / 2 - 9.25} rx={Math.min(7.6, w / 2 - 1)} ry={9.25} fill={white} stroke={INK} strokeWidth={0.9} />
                </>
              )}
              {k === 'tub' && (
                r.product.variant === 'freestanding' ? (
                  <ellipse cx={0} cy={0} rx={w / 2} ry={d / 2} fill={white} stroke={INK} strokeWidth={0.9} />
                ) : (
                  <>
                    <rect x={-w / 2} y={-d / 2} width={w} height={d} fill={white} stroke={INK} strokeWidth={0.9} />
                    <rect x={-w / 2 + 3} y={-d / 2 + 3} width={w - 6} height={d - 6} rx={Math.min(8, d / 3)} fill="none" stroke={INK} strokeWidth={0.6} opacity={0.6} />
                  </>
                )
              )}
              {k === 'shower' && (
                <>
                  <rect x={-w / 2} y={-d / 2} width={w} height={d} fill="#ecebe6" stroke={INK} strokeWidth={0.9} />
                  <path d={`M${-w / 2} ${-d / 2} L${w / 2} ${d / 2} M${w / 2} ${-d / 2} L${-w / 2} ${d / 2}`} stroke={INK} strokeWidth={0.6} opacity={0.4} />
                </>
              )}
              {k === 'vanity' && (
                <>
                  <rect x={-w / 2} y={-d / 2} width={w} height={d} fill={counter} stroke={INK} strokeWidth={0.9} />
                  {(r.product.variant === 'double' ? [-Math.min(15, w / 4), Math.min(15, w / 4)] : [0]).map((cx) => (
                    <ellipse key={cx} cx={cx} cy={-d / 2 + 10.25} rx={Math.min(8.5, w / 2 - 4)} ry={6.25} fill={white} stroke={INK} strokeWidth={0.7} />
                  ))}
                </>
              )}
            </g>
          );
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
      {drawn ? (
        outlines.map((o, i) => <polygon key={i} points={o.map((q) => q.join(',')).join(' ')} fill="none" stroke={highlight ? '#c2542d' : INK} style={highlight ? undefined : WALL_STYLE} strokeWidth={T * 1.4} strokeLinejoin="miter" />)
      ) : (
        <rect x={-T} y={-T} width={W + T * 2} height={L + T * 2} fill="none" stroke={highlight ? '#c2542d' : INK} style={highlight ? undefined : WALL_STYLE} strokeWidth={T} />
      )}
      {zones.map((z) => (
        <polygon key={z.id} points={z.pts.map((q) => q.join(',')).join(' ')} fill="none" stroke="#c2542d" strokeWidth={T * 0.4} strokeDasharray={`${T * 2} ${T * 1.2}`} opacity={0.8} />
      ))}
      {all
        .filter((r) => isOpening(r.product))
        .map((r) => {
          const b = r.box;
          const horiz = r.item.rotation === 0 || r.item.rotation === 180;
          if (drawn) {
            const st = { fill: r.product.kind === 'window' ? '#cfe0ea' : undefined, ...(r.product.kind === 'window' ? {} : GAP_STYLE) };
            return horiz ? (
              <rect key={r.item.id} x={b.minX} y={r.item.y - T * 0.7} width={b.maxX - b.minX} height={T * 1.4} style={st} />
            ) : (
              <rect key={r.item.id} x={r.item.x - T * 0.7} y={b.minY} width={T * 1.4} height={b.maxY - b.minY} style={st} />
            );
          }
          return horiz ? (
            <rect key={r.item.id} x={b.minX} y={r.item.y < 1 ? -T : L} width={b.maxX - b.minX} height={T} fill="#cfe0ea" style={r.product.kind === 'window' ? undefined : GAP_STYLE} />
          ) : (
            <rect key={r.item.id} x={r.item.x < 1 ? -T : W} y={b.minY} width={T} height={b.maxY - b.minY} fill="#cfe0ea" style={r.product.kind === 'window' ? undefined : GAP_STYLE} />
          );
        })}
    </svg>
  );
});

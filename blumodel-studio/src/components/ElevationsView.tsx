import { useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useDesignStore } from '../store/useDesignStore';
import { useResolvedItems } from '../store/derived';
import { alongWall, backsplashSegments, flushWall, WALLS, wallLength, type Resolved, type Wall } from '../lib/geometry';
import { resolveFinish } from '../lib/finish';
import { feetInches } from '../lib/format';
import { PAINTS, byId, resolveBacksplash } from '../data/finishes';
import { patternDataUrl } from '../lib/textures';
import { productCode } from '../data/catalog';
import { drawArt, SteelGradient } from './ProductArt';
import { Download } from './Icons';
import { downloadDataUrl, downloadText, slug } from '../lib/exporters';
import { useResolvedTheme, type Theme } from '../lib/theme';

const INK = '#2a2622';
const ACCENT = '#c2542d';

/**
 * The drawing around the wall follows the theme (the sheet, the hatched walls, the ground line, the
 * dimensions); the wall's paint, the tile and the products keep their real colours and dark line
 * work. SVG and PNG exports are always drawn light, for paper.
 */
interface ElevInk {
  ink: string;
  muted: string;
  sheet: string;
  accent: string;
}
const ELEV_INK: Record<Theme, ElevInk> = {
  light: { ink: INK, muted: '#7a7166', sheet: '#fbf9f4', accent: ACCENT },
  dark: { ink: '#ebe5da', muted: '#aaa192', sheet: '#1c1916', accent: '#ee8a61' },
};
const TILE_IN = 12;

const WALL_NAMES: Record<Wall, string> = { north: 'North', east: 'East', south: 'South', west: 'West' };

/** Viewed from inside the room, south and west walls read right-to-left in plan coordinates. */
function toView(wall: Wall, len: number, a0: number, a1: number): [number, number] {
  return wall === 'south' || wall === 'west' ? [len - a1, len - a0] : [a0, a1];
}

/** Where a drawing's bottom edge sits above the floor, given how the art is composed. */
function artBase(r: Resolved): number {
  if (r.product.kind === 'window') return r.z0 - 2.5;
  return r.z0;
}

function Dim({ x1, x2, y, label, small, ink }: { x1: number; x2: number; y: number; label: string; small?: boolean; ink: ElevInk }) {
  const t = 1.6;
  const fs = small ? 3.4 : 4.4;
  return (
    <g stroke={small ? ink.muted : ink.ink} fill={small ? ink.muted : ink.ink}>
      <line x1={x1} x2={x2} y1={y} y2={y} strokeWidth={0.35} />
      {[x1, x2].map((x) => (
        <line key={x} x1={x - t} y1={y + t} x2={x + t} y2={y - t} strokeWidth={0.6} />
      ))}
      {x2 - x1 > label.length * fs * 0.55 && (
        <text x={(x1 + x2) / 2} y={y - 1.4} textAnchor="middle" fontSize={fs} stroke="none" fontFamily="JetBrains Mono, monospace">
          {label}
        </text>
      )}
    </g>
  );
}

function VDim({ y1, y2, x, label, ink }: { y1: number; y2: number; x: number; label: string; ink: ElevInk }) {
  const t = 1.6;
  return (
    <g stroke={ink.muted} fill={ink.muted}>
      <line x1={x} x2={x} y1={y1} y2={y2} strokeWidth={0.35} />
      {[y1, y2].map((y) => (
        <line key={y} x1={x - t} y1={y + t} x2={x + t} y2={y - t} strokeWidth={0.6} />
      ))}
      <text x={x - 1.8} y={(y1 + y2) / 2} textAnchor="middle" fontSize={3.4} stroke="none" fontFamily="JetBrains Mono, monospace" transform={`rotate(-90 ${x - 1.8} ${(y1 + y2) / 2})`}>
        {label}
      </text>
    </g>
  );
}

export function ElevationsView() {
  const room = useDesignStore((s) => s.doc.room);
  const surfaces = useDesignStore((s) => s.doc.surfaces);
  const name = useDesignStore((s) => s.doc.name);
  const selectedId = useDesignStore((s) => s.selectedId);
  const select = useDesignStore((s) => s.select);
  const setUI = useDesignStore((s) => s.setUI);
  const toast = useDesignStore((s) => s.toast);
  const all = useResolvedItems();
  const svgRef = useRef<SVGSVGElement>(null);
  const theme = useResolvedTheme();
  const [forPaper, setForPaper] = useState(false);
  const ink = ELEV_INK[forPaper ? 'light' : theme];
  /** The drawing as markup, drawn in the light colours whatever the theme. */
  const paperMarkup = (): string | null => {
    flushSync(() => setForPaper(true));
    try {
      return svgRef.current ? new XMLSerializer().serializeToString(svgRef.current) : null;
    } finally {
      setForPaper(false);
    }
  };

  const byWall = useMemo(() => {
    const m: Record<Wall, Resolved[]> = { north: [], east: [], south: [], west: [] };
    for (const r of all) {
      const w = flushWall(r, room);
      if (w) m[w].push(r);
      // A corner unit is visible on both walls it touches.
      if (r.product.kind === 'corner') {
        const b = r.box;
        const touching: Wall[] = [];
        if (b.minY < 1) touching.push('north');
        if (b.maxY > room.lengthIn - 1) touching.push('south');
        if (b.minX < 1) touching.push('west');
        if (b.maxX > room.widthIn - 1) touching.push('east');
        for (const t of touching) if (t !== w) m[t].push(r);
      }
    }
    return m;
  }, [all, room]);

  const busiest = WALLS.reduce((a, b) => (byWall[b].length > byWall[a].length ? b : a), 'north' as Wall);
  const [chosen, setChosen] = useState<Wall | null>(null);
  const wall = chosen ?? busiest;

  const len = wallLength(wall, room);
  const H = room.ceilingIn;
  const items = [...byWall[wall]].sort((a, b) => (a.product.kind === 'window' || a.product.kind === 'door' ? -1 : 0) - (b.product.kind === 'window' || b.product.kind === 'door' ? -1 : 0) || a.z0 - b.z0);
  const paint = byId(PAINTS, surfaces.paintId);
  const splash = resolveBacksplash(surfaces.backsplashId, surfaces.countertopId);
  const splashUrl = patternDataUrl(splash.pattern, 128, TILE_IN);
  const segs = backsplashSegments(all, room).filter((s) => s.wall === wall);

  const Y = (fromFloor: number) => H - fromFloor;
  const edges = new Set<number>([0, len]);
  items.forEach((r) => {
    if (r.z0 >= 40 && r.product.kind !== 'window') return;
    const [s, e] = alongWall(wall, r.box);
    const [v0, v1] = toView(wall, len, s, e);
    edges.add(Math.round(v0 * 2) / 2);
    edges.add(Math.round(v1 * 2) / 2);
  });
  const chain = [...edges].filter((v) => v >= 0 && v <= len).sort((a, b) => a - b);
  const colors = new Set<string>();

  const pad = { l: 24, r: 10, t: 22, b: 30 };
  const vb = `${-pad.l} ${-pad.t} ${len + pad.l + pad.r} ${H + pad.t + pad.b}`;

  const exportSvg = () => {
    const src = paperMarkup();
    if (!src) return;
    downloadText(src, `${slug(name)}-${wall}-elevation.svg`, 'image/svg+xml');
    toast(`${WALL_NAMES[wall]} elevation saved as SVG.`, 'ok');
  };
  const exportPng = () => {
    const src = paperMarkup();
    if (!src) return;
    const img = new Image();
    const scale = 2400 / (len + pad.l + pad.r);
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = Math.round((len + pad.l + pad.r) * scale);
      c.height = Math.round((H + pad.t + pad.b) * scale);
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#fbf9f4';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      downloadDataUrl(c.toDataURL('image/png'), `${slug(name)}-${wall}-elevation.png`);
      toast(`${WALL_NAMES[wall]} elevation saved as PNG.`, 'ok');
    };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(src)}`;
  };

  return (
    <div className="elev-view">
      <div className="elev-bar">
        <div className="seg" role="tablist" aria-label="Wall">
          {WALLS.map((w) => (
            <button key={w} role="tab" aria-selected={w === wall} className={w === wall ? 'on' : ''} onClick={() => setChosen(w)}>
              {WALL_NAMES[w]} <span className="count">{byWall[w].length}</span>
            </button>
          ))}
        </div>
        <span className="elev-caption">Looking at the {WALL_NAMES[wall].toLowerCase()} wall from inside the room · {feetInches(len)} long</span>
        <div className="elev-actions">
          <button className="btn" onClick={exportSvg}><Download /> SVG</button>
          <button className="btn" onClick={exportPng}><Download /> PNG</button>
        </div>
      </div>
      <div className="elev-canvas">
        <svg ref={svgRef} xmlns="http://www.w3.org/2000/svg" viewBox={vb} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`${WALL_NAMES[wall]} wall elevation`}>
          <defs>
            <pattern id="splash" patternUnits="userSpaceOnUse" width={TILE_IN} height={TILE_IN} x={0} y={Y(36)}>
              <image href={splashUrl} width={TILE_IN} height={TILE_IN} preserveAspectRatio="none" />
            </pattern>
            <pattern id="hatch" patternUnits="userSpaceOnUse" width={3} height={3} patternTransform="rotate(45)">
              <line x1={0} y1={0} x2={0} y2={3} stroke={ink.ink} strokeWidth={0.5} />
            </pattern>
          </defs>
          <rect x={-pad.l} y={-pad.t} width={len + pad.l + pad.r} height={H + pad.t + pad.b} fill={ink.sheet} />
          <rect x={0} y={0} width={len} height={H} fill={paint.hex} />
          <rect x={-5} y={0} width={5} height={H} fill="url(#hatch)" stroke={ink.ink} strokeWidth={0.6} />
          <rect x={len} y={0} width={5} height={H} fill="url(#hatch)" stroke={ink.ink} strokeWidth={0.6} />
          <rect x={-5} y={-5} width={len + 10} height={5} fill="url(#hatch)" stroke={ink.ink} strokeWidth={0.6} />

          {segs.map((s, i) => {
            const [v0, v1] = toView(wall, len, s.start, s.end);
            return <rect key={i} x={v0} y={Y(s.top)} width={v1 - v0} height={s.top - s.bottom} fill="url(#splash)" stroke={INK} strokeWidth={0.3} />;
          })}

          {items.map((r) => {
            const finish = resolveFinish(r.item, r.product, surfaces);
            const art = drawArt({ product: r.product, finish, surfaces, width: r.w });
            colors.add(art.color);
            const [s, e] = alongWall(wall, r.box);
            const [v0] = toView(wall, len, s, e);
            const x = r.product.kind === 'corner' ? v0 + (r.box.maxX - r.box.minX - r.w) / 2 : v0;
            const base = artBase(r);
            const top = Y(base) - art.H;
            const selected = r.item.id === selectedId;
            return (
              <g
                key={r.item.id}
                transform={`translate(${x} ${top})`}
                className="elev-item"
                onClick={() => {
                  select(r.item.id);
                  setUI({ rightTab: 'details' });
                }}
              >
                <g strokeWidth={0.5} strokeLinejoin="round">{art.nodes}</g>
                {selected && <rect x={-1} y={-1} width={r.w + 2} height={art.H + 2} fill="none" stroke={ink.accent} strokeWidth={0.9} strokeDasharray="2 1.2" />}
                {r.product.kind !== 'window' && r.product.kind !== 'door' && r.w >= 12 && (
                  <text x={r.w / 2} y={art.H - (r.z0 > 40 ? 2.4 : 1.4)} textAnchor="middle" fontSize={2.8} fill={r.z0 > 40 ? INK : '#fff'} fontFamily="JetBrains Mono, monospace" style={{ paintOrder: 'stroke' }} stroke={r.z0 > 40 ? '#fbf9f4' : '#2a2622'} strokeWidth={0.7}>
                    {productCode(r.product, r.w)}
                  </text>
                )}
              </g>
            );
          })}

          <line x1={-10} x2={len + 10} y1={H} y2={H} stroke={ink.ink} strokeWidth={1.2} />
          <Dim x1={0} x2={len} y={-12} label={feetInches(len)} ink={ink} />
          {chain.slice(1).map((v, i) => (
            <Dim key={i} x1={chain[i]} x2={v} y={H + 9} label={feetInches(v - chain[i]).replace(/^0' /, '')} small ink={ink} />
          ))}
          <VDim x={-12} y1={Y(0)} y2={Y(36)} label={`36"`} ink={ink} />
          {items.some((r) => r.product.kind === 'wall') && <VDim x={-12} y1={Y(54)} y2={Y(84)} label={`30"`} ink={ink} />}
          <VDim x={-19} y1={Y(0)} y2={Y(H)} label={feetInches(H)} ink={ink} />
          <text x={len} y={H + 22} textAnchor="end" fontSize={3.6} fill={ink.muted} fontFamily="JetBrains Mono, monospace">
            {WALL_NAMES[wall].toUpperCase()} ELEVATION
          </text>
          <defs>{[...colors].map((c) => <SteelGradient key={c} color={c} />)}</defs>
        </svg>
        {items.length === 0 && <div className="elev-empty">Nothing is set against the {WALL_NAMES[wall].toLowerCase()} wall yet.</div>}
      </div>
    </div>
  );
}

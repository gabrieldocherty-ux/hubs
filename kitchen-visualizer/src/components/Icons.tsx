import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;

const base = (p: P) => ({
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  ...p,
});

export const Undo = (p: P) => (
  <svg {...base(p)}><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></svg>
);
export const Redo = (p: P) => (
  <svg {...base(p)}><path d="m15 14 5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></svg>
);
export const RotateCw = (p: P) => (
  <svg {...base(p)}><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></svg>
);
export const RotateCcw = (p: P) => (
  <svg {...base(p)}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>
);
export const Copy = (p: P) => (
  <svg {...base(p)}><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
);
export const Trash = (p: P) => (
  <svg {...base(p)}><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /></svg>
);
export const Flip = (p: P) => (
  <svg {...base(p)}><path d="M12 3v18" /><path d="m8 7-5 5 5 5V7Z" /><path d="m16 7 5 5-5 5V7Z" /></svg>
);
export const Download = (p: P) => (
  <svg {...base(p)}><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></svg>
);
export const Upload = (p: P) => (
  <svg {...base(p)}><path d="M12 21V9" /><path d="m7 14 5-5 5 5" /><path d="M5 3h14" /></svg>
);
export const Search = (p: P) => (
  <svg {...base(p)}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
);
export const Check = (p: P) => (
  <svg {...base(p)}><path d="m5 12 5 5 9-10" /></svg>
);
export const Alert = (p: P) => (
  <svg {...base(p)}><path d="M12 3 2 20h20L12 3Z" /><path d="M12 10v4" /><path d="M12 17h.01" /></svg>
);
export const Stop = (p: P) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="m15 9-6 6" /><path d="m9 9 6 6" /></svg>
);
export const Info = (p: P) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 8h.01" /></svg>
);
export const Plus = (p: P) => (
  <svg {...base(p)}><path d="M12 5v14" /><path d="M5 12h14" /></svg>
);
export const Close = (p: P) => (
  <svg {...base(p)}><path d="m6 6 12 12" /><path d="M18 6 6 18" /></svg>
);
export const Chevron = (p: P) => (
  <svg {...base(p)}><path d="m6 9 6 6 6-6" /></svg>
);
export const PlanIcon = (p: P) => (
  <svg {...base(p)}><rect x="3" y="3" width="18" height="18" rx="1" /><path d="M3 9h7v12" /><path d="M14 3v6h7" /></svg>
);
export const CubeIcon = (p: P) => (
  <svg {...base(p)}><path d="M12 2 3 7v10l9 5 9-5V7l-9-5Z" /><path d="M3 7l9 5 9-5" /><path d="M12 12v10" /></svg>
);
export const SplitIcon = (p: P) => (
  <svg {...base(p)}><rect x="3" y="4" width="18" height="16" rx="1.5" /><path d="M12 4v16" /></svg>
);

export const WallsIcon = (p: P) => (
  <svg {...base(p)}><path d="M3 20h18" /><rect x="4" y="12" width="7" height="8" /><rect x="13" y="12" width="7" height="8" /><rect x="4" y="4" width="16" height="5" /></svg>
);

/** Brand mark: a door-swing arc inside a plan square. */
export const Logo = (p: P) => (
  <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden {...p}>
    <rect x="2.5" y="2.5" width="27" height="27" rx="2" fill="none" stroke="currentColor" strokeWidth="2.4" />
    <path d="M9 23V9" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    <path d="M9 9a14 14 0 0 1 14 14" fill="none" stroke="#c2542d" strokeWidth="2.4" strokeLinecap="round" strokeDasharray="0.1 4.2" />
    <circle cx="23" cy="23" r="2.2" fill="#c2542d" />
  </svg>
);

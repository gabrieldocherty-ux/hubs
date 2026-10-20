import type { PlacedItem, Room, Rotation } from '../types';
import { makeId } from '../lib/id';

/**
 * Starting layouts for a bathroom, the way they are usually built: the tub or shower across the
 * short end, the vanity and the toilet along a long wall with code clearances (the toilet's centre
 * 18″ from the vanity, 21″+ clear in front), and the door on the opposite long wall, swinging clear
 * of the fixtures. Works on a plain rectangle; a drawn room starts empty.
 */
export type BathLayoutId = 'three-piece' | 'shower-ensuite' | 'powder';

export interface BathLayout {
  id: BathLayoutId;
  name: string;
  blurb: string;
  /** Smallest room, inches (short side x long side). */
  minShort: number;
  minLong: number;
}

export const BATH_LAYOUTS: BathLayout[] = [
  { id: 'three-piece', name: 'Tub, toilet and vanity', blurb: 'The classic 5′ × 8′ bathroom: a tub across the end.', minShort: 60, minLong: 90 },
  { id: 'shower-ensuite', name: 'Shower ensuite', blurb: 'A walk-in or corner shower instead of a tub, with a bigger vanity.', minShort: 60, minLong: 102 },
  { id: 'powder', name: 'Powder room', blurb: 'A small vanity and a toilet.', minShort: 48, minLong: 60 },
];

export const bathLayoutFits = (l: BathLayout, room: Room) => Math.min(room.widthIn, room.lengthIn) >= l.minShort && Math.max(room.widthIn, room.lengthIn) >= l.minLong;

const pick = (opts: number[], max: number, fallback: number) => [...opts].reverse().find((o) => o <= max) ?? fallback;

/**
 * Items for a layout. Coordinates are worked out along the long wall (`a`, from the corner) and
 * across the room (`c`, from that wall), then turned into plan x/y for whichever way the room runs.
 */
export function bathLayoutItems(id: BathLayoutId, room: Room): PlacedItem[] {
  const W = room.widthIn;
  const L = room.lengthIn;
  const tall = L >= W; // the long walls run north-south
  const long = tall ? L : W;
  const short = tall ? W : L;
  // Fixtures along the "fixture wall": west when the room is tall, north when it is wide.
  const along = (a: number, c: number): { x: number; y: number } => (tall ? { x: c, y: a } : { x: a, y: c });
  const fixtureRot: Rotation = tall ? 270 : 0;
  const endRot: Rotation = tall ? 180 : 90; // the far short wall: south when tall, east when wide
  const doorRot: Rotation = tall ? 90 : 180; // the other long wall: east when tall, south when wide
  const item = (productId: string, p: { x: number; y: number }, rotation: Rotation, widthIn?: number): PlacedItem => ({
    id: makeId(),
    productId,
    ...p,
    rotation,
    finishIndex: 0,
    ...(widthIn ? { widthIn } : {}),
  });
  const out: PlacedItem[] = [];

  // The wet end across the far short wall.
  let wetDepth = 0;
  if (id === 'three-piece') {
    const tw = pick([54, 60, 66, 72], short, 60);
    wetDepth = 30;
    const endPos = tall ? { x: tw / 2, y: L - 15 } : { x: W - 15, y: tw / 2 };
    out.push(item('tub', endPos, endRot, tw === 60 ? undefined : tw));
  } else if (id === 'shower-ensuite') {
    if (short >= 60) {
      const sw = pick([48, 60, 72], short, 60);
      wetDepth = 36;
      const endPos = tall ? { x: sw / 2, y: L - 18 } : { x: W - 18, y: sw / 2 };
      out.push(item('shower-walkin', endPos, endRot, sw === 60 ? undefined : sw));
    } else {
      wetDepth = 36;
      const endPos = tall ? { x: 18, y: L - 18 } : { x: W - 18, y: 18 };
      out.push(item('shower-corner', endPos, endRot));
    }
  }

  // Vanity from the near corner, then the toilet 18″ (centre) past its end.
  // Leave the toilet 36″ between the vanity and the wet end (18″ each side of its centre).
  const room4Vanity = long - wetDepth - 6 - 36;
  const double = id === 'shower-ensuite' && room4Vanity >= 60;
  const vw = id === 'powder' ? pick([24, 30, 36], Math.max(24, room4Vanity), 24) : double ? 60 : pick([24, 30, 36, 42, 48], Math.max(24, room4Vanity), 24);
  const vd = 21;
  out.push(item(double ? 'vanity-double' : 'vanity', along(6 + vw / 2, vd / 2), fixtureRot, double || vw === 36 ? undefined : vw));
  out.push(item('mirror', along(6 + vw / 2, 0.75), fixtureRot, Math.min(vw - 6, 48) === 30 ? undefined : Math.min(vw - 6, 48)));
  out.push(item('toilet', along(Math.min(6 + vw + 18, long - wetDepth - 18), 29 / 2), fixtureRot));

  // The door on the opposite long wall, near the dry end, swinging away from the fixtures.
  const doorPos = tall ? { x: W, y: 6 + 16 } : { x: 6 + 16, y: L };
  out.push(item('door', doorPos, doorRot, 30));
  return out;
}

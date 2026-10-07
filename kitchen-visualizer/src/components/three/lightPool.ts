/**
 * The pendant light pool (pure, unit-tested).
 *
 * three compiles a shader program per light count, so a light that appears when a pendant is
 * added re-links every lit material (a 1.6 s frame on the dev box). The room instead mounts a
 * fixed pool of `MAX_LIGHTS` point lights once; each frame-independent assignment below hands
 * them to the first pendants in the kitchen's item order. Unused lights stay in the scene at
 * intensity 0, so the light count (and every program) never changes.
 */

export const MAX_LIGHTS = 6;

export interface PendantLike {
  id: string;
  /** Plan position, inches (x from the west wall, y from the north wall). */
  x: number;
  y: number;
  /** The pendant's underside above the floor, inches. */
  elevationIn: number;
  variant?: string;
}

export interface LightSlot {
  /** Item the light belongs to, or null when the slot is unused (intensity 0). */
  itemId: string | null;
  /** Position in the room group's frame, inches (x, height, plan y). */
  pos: [number, number, number];
  intensity: number;
}

/** Intensity of one pendant's light (a linear pendant is a long bar of bulbs). */
export function pendantIntensity(variant?: string): number {
  return variant === 'linear' ? 26 : 16;
}

/**
 * Exactly `max` slots: the first `max` pendants (in the order given, which is the kitchen's
 * item order, so it is stable) get a light 1″ under their shade; the rest of the slots are off.
 */
export function assignPendantLights(pendants: PendantLike[], max = MAX_LIGHTS): LightSlot[] {
  const slots: LightSlot[] = [];
  for (let i = 0; i < max; i++) {
    const p = pendants[i];
    slots.push(p ? { itemId: p.id, pos: [p.x, p.elevationIn - 1, p.y], intensity: pendantIntensity(p.variant) } : { itemId: null, pos: [0, 0, 0], intensity: 0 });
  }
  return slots;
}

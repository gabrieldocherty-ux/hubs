import type { Room, Surfaces } from '../types';

/**
 * Defaults for a new or incomplete kitchen. Kept free of store and template imports so
 * pure modules (compose, sanitizeDoc, the generator) can use them without pulling in zustand.
 */
export const DEFAULT_ROOM: Room = { widthIn: 200, lengthIn: 156, ceilingIn: 108 };

export const DEFAULT_SURFACES: Surfaces = {
  cabinetFinishId: 'warm-white',
  doorStyle: 'shaker',
  hardwareId: 'brass',
  countertopId: 'calacatta',
  backsplashId: 'zellige-white',
  flooringId: 'herringbone',
  paintId: 'chalk',
};

export const DEFAULT_KITCHEN_NAME = 'Untitled Kitchen';

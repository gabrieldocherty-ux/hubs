import { useMemo } from 'react';
import type { Room, Surfaces } from '../../types';
import { COUNTERTOPS, HARDWARE, PAINTS, byId, resolveBacksplash } from '../../data/finishes';
import { cabinetFinish } from '../../lib/finish';
import { DEFAULT_ROOM, DEFAULT_SURFACES } from '../../data/defaults';
import { hardwareMaterial, surfaceMaterial } from './materials';
import type { SceneCtx } from './parts';

/**
 * The kitchen-wide materials and settings every model reads (countertop, splash, cabinet finish,
 * door style, hardware, ceiling, paint). Pure given the surfaces and the room, so a model can be
 * drawn outside a kitchen (the product page) with the defaults.
 */
export function makeSceneCtx(surfaces: Surfaces, room: Pick<Room, 'ceilingIn'>): SceneCtx {
  const ct = byId(COUNTERTOPS, surfaces.countertopId);
  const counter = surfaceMaterial(`counter:${ct.id}`, ct.pattern, ct.gloss);
  const bs = resolveBacksplash(surfaces.backsplashId, surfaces.countertopId);
  const splash = surfaceMaterial(`splash:${bs.id}:${ct.id}`, bs.pattern, bs.gloss);
  const hw = byId(HARDWARE, surfaces.hardwareId);
  return {
    counterMat: counter.mat,
    counterTile: counter.tileIn,
    counterIsStone: ct.pattern.type !== 'wood',
    splashMat: splash.mat,
    splashTile: splash.tileIn,
    cabinet: cabinetFinish(surfaces),
    doorStyle: surfaces.doorStyle,
    hwMat: hardwareMaterial(hw.hex, hw.roughness),
    ceiling: room.ceilingIn,
    paintHex: byId(PAINTS, surfaces.paintId).hex,
  };
}

export function useSceneCtx(surfaces: Surfaces, room: Pick<Room, 'ceilingIn'>): SceneCtx {
  return useMemo(() => makeSceneCtx(surfaces, room), [surfaces, room.ceilingIn]);
}

/** The context a product is shown in on its own page: the default kitchen's surfaces. */
export function defaultSceneCtx(ceilingIn = DEFAULT_ROOM.ceilingIn): SceneCtx {
  return makeSceneCtx(DEFAULT_SURFACES, { ceilingIn });
}

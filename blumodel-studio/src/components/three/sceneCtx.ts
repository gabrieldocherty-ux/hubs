import { useMemo } from 'react';
import type { Room, Surfaces } from '../../types';
import { COUNTERTOPS, PAINTS, byId, resolveBacksplash } from '../../data/finishes';
import { resolveFaucet, resolveHardware } from '../../lib/fixtures';
import { useFixtureVersion } from '../../lib/useFixtures';
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
  const hw = resolveHardware(surfaces);
  const faucet = resolveFaucet(surfaces);
  return {
    counterMat: counter.mat,
    counterTile: counter.tileIn,
    counterIsStone: ct.pattern.type !== 'wood',
    splashMat: splash.mat,
    splashTile: splash.tileIn,
    cabinet: cabinetFinish(surfaces),
    doorStyle: surfaces.doorStyle,
    hwMat: hardwareMaterial(hw.hex, hw.roughness),
    pull: hw.fixture,
    faucet: faucet?.fixture ?? null,
    faucetMat: faucet ? hardwareMaterial(faucet.hex, faucet.roughness) : hardwareMaterial(hw.hex, hw.roughness),
    ceiling: room.ceilingIn,
    paintHex: byId(PAINTS, surfaces.paintId).hex,
    crown: surfaces.crown === 'flat' || surfaces.crown === 'cove' ? surfaces.crown : 'none',
    underCabinet: surfaces.underCabinet === 'led',
  };
}

export function useSceneCtx(surfaces: Surfaces, room: Pick<Room, 'ceilingIn'>): SceneCtx {
  // The retail faucet and hardware draw once their catalog entry or the kitchen's snapshot is registered.
  const fixtures = useFixtureVersion();
  return useMemo(() => makeSceneCtx(surfaces, room), [surfaces, room.ceilingIn, fixtures]);
}

/** The context a product is shown in on its own page: the default kitchen's surfaces. */
export function defaultSceneCtx(ceilingIn = DEFAULT_ROOM.ceilingIn): SceneCtx {
  return makeSceneCtx(DEFAULT_SURFACES, { ceilingIn });
}

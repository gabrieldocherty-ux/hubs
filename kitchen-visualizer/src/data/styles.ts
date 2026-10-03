import type { Surfaces } from '../types';

export interface StylePreset {
  id: string;
  name: string;
  blurb: string;
  surfaces: Surfaces;
  /** Cabinet finish for islands: the two-tone accent that makes each look. */
  island: string;
}

/** Curated finish combinations that work together; each applies as a single undoable step. */
export const STYLE_PRESETS: StylePreset[] = [
  {
    id: 'farmhouse',
    name: 'Modern Farmhouse',
    blurb: 'Warm white shaker, marble, brass',
    surfaces: { cabinetFinishId: 'warm-white', doorStyle: 'shaker', hardwareId: 'brass', countertopId: 'calacatta', backsplashId: 'subway-white', flooringId: 'oak-natural', paintId: 'chalk' },
    island: 'sage',
  },
  {
    id: 'moody',
    name: 'Moody Green',
    blurb: 'Deep forest reeding, Nero stone',
    surfaces: { cabinetFinishId: 'forest', doorStyle: 'fluted', hardwareId: 'brass', countertopId: 'nero', backsplashId: 'stack-terracotta', flooringId: 'herringbone', paintId: 'sage-wall' },
    island: 'walnut',
  },
  {
    id: 'japandi',
    name: 'Japandi',
    blurb: 'Rift oak slab, concrete, calm',
    surfaces: { cabinetFinishId: 'white-oak', doorStyle: 'slab', hardwareId: 'black', countertopId: 'concrete', backsplashId: 'zellige-white', flooringId: 'oak-natural', paintId: 'bone' },
    island: 'white-oak',
  },
  {
    id: 'coastal',
    name: 'Coastal',
    blurb: 'Soft white, sea-glass zellige',
    surfaces: { cabinetFinishId: 'warm-white', doorStyle: 'shaker', hardwareId: 'nickel', countertopId: 'carrara', backsplashId: 'zellige-sage', flooringId: 'porcelain', paintId: 'fog' },
    island: 'navy',
  },
  {
    id: 'midcentury',
    name: 'Mid-Century',
    blurb: 'Walnut, terrazzo, sunny walls',
    surfaces: { cabinetFinishId: 'walnut', doorStyle: 'slab', hardwareId: 'brass', countertopId: 'terrazzo', backsplashId: 'stack-terracotta', flooringId: 'terracotta', paintId: 'butter' },
    island: 'clay',
  },
  {
    id: 'parisian',
    name: 'Parisian',
    blurb: 'Greige, slab marble, checkerboard',
    surfaces: { cabinetFinishId: 'greige', doorStyle: 'shaker', hardwareId: 'nickel', countertopId: 'calacatta', backsplashId: 'slab-match', flooringId: 'checker', paintId: 'chalk' },
    island: 'charcoal',
  },
  {
    id: 'navy',
    name: 'Harbor Navy',
    blurb: 'Navy shaker, brass, herringbone',
    surfaces: { cabinetFinishId: 'navy', doorStyle: 'shaker', hardwareId: 'brass', countertopId: 'carrara', backsplashId: 'subway-white', flooringId: 'herringbone', paintId: 'chalk' },
    island: 'warm-white',
  },
  {
    id: 'industrial',
    name: 'Soft Industrial',
    blurb: 'Charcoal, soapstone, ink tile',
    surfaces: { cabinetFinishId: 'charcoal', doorStyle: 'slab', hardwareId: 'black', countertopId: 'soapstone', backsplashId: 'stack-ink', flooringId: 'concrete-floor', paintId: 'bone' },
    island: 'white-oak',
  },
];

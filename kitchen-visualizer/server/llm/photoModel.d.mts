// Types for photoModel.mjs, so the browser code (TypeScript) can import the shared validator.
import type { ApplianceKind, CabinetDoor, PhotoModel, PhotoStyle, PhotoWall } from '../../src/lib/generate/photoModel';

export interface FinishChoice {
  id: string;
  name: string;
  hex: string;
}

export declare const WALLS: PhotoWall[];
export declare const APPLIANCE_KINDS: ApplianceKind[];
export declare const CABINET_DOORS: CabinetDoor[];
export declare const APPLIANCE_WIDTHS: Record<ApplianceKind, { min: number; max: number; def: number }>;
export declare const LIMITS: {
  room: { widthIn: [number, number]; lengthIn: [number, number]; ceilingIn: [number, number] };
  maxOpenings: number;
  maxRuns: number;
  maxAppliances: number;
  window: { widthIn: [number, number]; heightIn: [number, number]; sillIn: [number, number] };
  door: { widthIn: [number, number]; heightIn: [number, number] };
  minRunIn: number;
  island: { widthIn: [number, number]; depthIn: [number, number]; seats: [number, number] };
  maxNotes: number;
};
export declare const DEFAULT_ROOM: { widthIn: number; lengthIn: number; ceilingIn: number };
export declare const FINISH_CHOICES: {
  cabinet: FinishChoice[];
  countertop: FinishChoice[];
  backsplash: FinishChoice[];
  flooring: FinishChoice[];
  hardware: FinishChoice[];
  paint: FinishChoice[];
};
export declare const DEFAULT_STYLE: PhotoStyle;
export declare function colorDistance(a: string, b: string): number;
export declare function closestFinish(list: FinishChoice[], hex: string): FinishChoice;
export declare function clampPhotoModel(raw: unknown): { model: PhotoModel; warnings: string[] } | null;
export declare function photoModelJsonSchema(): Record<string, unknown>;

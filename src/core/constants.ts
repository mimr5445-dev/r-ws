// Shared engine constants.
// Keeping these in one place prevents the validator, the engine and the UI
// from slowly drifting apart (e.g. three different scale limits).
import type { ActorTemplate, Domain, Faction, SoundId } from './types';

export const TICK_RATE = 30;
export const DT = 1 / TICK_RATE;

export const DOMAINS = ['land', 'sea', 'air'] as const satisfies readonly Domain[];
export const FACTIONS = ['blue', 'red', 'neutral'] as const satisfies readonly Faction[];
export const ACTOR_KINDS = [
  'person',
  'vehicle',
  'ship',
  'building',
  'air'
] as const satisfies readonly ActorTemplate['kind'][];

export const SOUND_IDS = [
  'build_complete',
  'alert_ping',
  'move_order',
  'spawn_pop',
  'jet_takeoff',
  'missile_launch',
  'explosion',
  'ship_horn'
] as const satisfies readonly SoundId[];

/** Hard limits for an individual unit's scale multiplier (`scale` / `resize`). */
export const ENTITY_SCALE_MIN = 0.2;
export const ENTITY_SCALE_MAX = 4;

/** Practical limits for the global "unit size" slider. */
export const UNIT_SCALE_MIN = 0.3;
export const UNIT_SCALE_MAX = 2;

/** Camera zoom limits. */
export const CAMERA_ZOOM_MIN = 0.25;
export const CAMERA_ZOOM_MAX = 4;

export function clampEntityScale(value: number, fallback = 1): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(ENTITY_SCALE_MIN, Math.min(ENTITY_SCALE_MAX, value));
}

export function clampUnitScale(value: number, fallback = 1): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(UNIT_SCALE_MIN, Math.min(UNIT_SCALE_MAX, value));
}

export function clampCameraZoom(value: number, fallback = 1): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.max(CAMERA_ZOOM_MIN, Math.min(CAMERA_ZOOM_MAX, value));
}

export function isSoundId(value: unknown): value is SoundId {
  return typeof value === 'string' && (SOUND_IDS as readonly string[]).includes(value);
}

export function isFaction(value: unknown): value is Faction {
  return typeof value === 'string' && (FACTIONS as readonly string[]).includes(value);
}

export function isDomain(value: unknown): value is Domain {
  return typeof value === 'string' && (DOMAINS as readonly string[]).includes(value);
}

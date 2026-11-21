import { Domain, EntityState, MapPack, Point } from './types';

/** Small angle helper kept local to avoid circular imports with engine. */
function normalizeAngleDiff(target: number, current: number): number {
  let d = target - current;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** DT is imported only for typing clarity; callers pass the actual dt. */
export const MOVEMENT_TICK_HINT = 1 / 30;

export interface MovementContext {
  map: MapPack;
  canOccupy: (x: number, y: number, domain: Domain) => boolean;
  dt: number;
}

/** Kind-specific tuning for professional feel. */
interface KindMotionProfile {
  /** How aggressively we accelerate (fraction of max speed per second). */
  accelFactor: number;
  /** How aggressively we brake. */
  brakeFactor: number;
  /** Minimum look-ahead distance (world units). */
  lookAheadMin: number;
  /** Look-ahead time (seconds) scaled by current speed. */
  lookAheadTime: number;
  /** Maximum look-ahead distance. */
  lookAheadMax: number;
  /** Extra slowdown when turning hard (0 = none, 1 = strong). */
  turnSlowdown: number;
  /** Arrival capture radius multiplier relative to step size. */
  arrivalSlack: number;
  /** Whether the unit rotates its visual (false for persons). */
  rotates: boolean;
  /** Banking strength for air units. */
  bankStrength: number;
}

const PROFILES: Record<EntityState['kind'], KindMotionProfile> = {
  person: {
    accelFactor: 4.2,
    brakeFactor: 5.5,
    lookAheadMin: 12,
    lookAheadTime: 0.35,
    lookAheadMax: 48,
    turnSlowdown: 0.15,
    arrivalSlack: 1.4,
    rotates: false,
    bankStrength: 0
  },
  vehicle: {
    accelFactor: 2.4,
    brakeFactor: 3.8,
    lookAheadMin: 22,
    lookAheadTime: 0.55,
    lookAheadMax: 95,
    turnSlowdown: 0.55,
    arrivalSlack: 1.6,
    rotates: true,
    bankStrength: 0
  },
  ship: {
    accelFactor: 1.35,
    brakeFactor: 2.1,
    lookAheadMin: 38,
    lookAheadTime: 0.85,
    lookAheadMax: 160,
    turnSlowdown: 0.72,
    arrivalSlack: 2.0,
    rotates: true,
    bankStrength: 0
  },
  air: {
    accelFactor: 3.1,
    brakeFactor: 2.6,
    lookAheadMin: 40,
    lookAheadTime: 0.7,
    lookAheadMax: 180,
    turnSlowdown: 0.35,
    arrivalSlack: 2.2,
    rotates: true,
    bankStrength: 0.55
  },
  building: {
    accelFactor: 0,
    brakeFactor: 0,
    lookAheadMin: 0,
    lookAheadTime: 0,
    lookAheadMax: 0,
    turnSlowdown: 0,
    arrivalSlack: 1,
    rotates: false,
    bankStrength: 0
  }
};

function pathLengthFrom(path: Point[], from: Point): number {
  if (path.length === 0) return 0;
  let len = Math.hypot(path[0].x - from.x, path[0].y - from.y);
  for (let i = 1; i < path.length; i++) {
    len += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  }
  return len;
}

/**
 * Sample a point along the remaining path at the given arc distance from the entity.
 * Returns the point and whether we reached (or passed) the final waypoint.
 */
function sampleLookAhead(path: Point[], from: Point, distance: number): { point: Point; atEnd: boolean } {
  if (path.length === 0) return { point: { ...from }, atEnd: true };

  let remaining = distance;
  let prev = from;

  for (let i = 0; i < path.length; i++) {
    const segLen = Math.hypot(path[i].x - prev.x, path[i].y - prev.y);
    if (segLen < 0.001) {
      prev = path[i];
      continue;
    }
    if (remaining <= segLen) {
      const t = remaining / segLen;
      return {
        point: {
          x: prev.x + (path[i].x - prev.x) * t,
          y: prev.y + (path[i].y - prev.y) * t
        },
        atEnd: false
      };
    }
    remaining -= segLen;
    prev = path[i];
  }

  // Past the end of the path
  return { point: { ...path[path.length - 1] }, atEnd: true };
}

/**
 * Estimate curvature / turn severity of the upcoming path (0 = straight, 1 = sharp).
 * Used to reduce speed before corners.
 */
function upcomingTurnSeverity(path: Point[], from: Point, lookDist: number): number {
  if (path.length < 2) return 0;

  const near = sampleLookAhead(path, from, Math.min(lookDist * 0.35, 30)).point;
  const far = sampleLookAhead(path, from, lookDist).point;

  const a1 = Math.atan2(near.y - from.y, near.x - from.x);
  const a2 = Math.atan2(far.y - near.y, far.x - near.x);
  const diff = Math.abs(normalizeAngleDiff(a2, a1));
  // Map 0..π → 0..1 with emphasis on larger angles
  return Math.min(1, (diff / Math.PI) * 1.6);
}

/**
 * Professional path-following update for one entity.
 * Mutates the entity in place (x, y, angle, currentSpeed, path, isMoving, bankAngle, arrivedTick).
 * Returns true if the entity just arrived this tick.
 */
export function updateEntityMovement(e: EntityState, ctx: MovementContext): boolean {
  const { map, canOccupy, dt } = ctx;
  const profile = PROFILES[e.kind] ?? PROFILES.vehicle;

  // Buildings never move
  if (e.kind === 'building' || e.speed <= 0) {
    e.isMoving = false;
    e.currentSpeed = 0;
    e.bankAngle *= 0.8;
    return false;
  }

  if (e.path.length === 0) {
    e.isMoving = false;
    e.currentSpeed = Math.max(0, e.currentSpeed - e.speed * profile.brakeFactor * dt);
    if (e.currentSpeed < 0.5) e.currentSpeed = 0;
    e.bankAngle *= 0.85;
    return false;
  }

  e.isMoving = true;

  // --- 1. Consume waypoints that are already behind or very close ---
  // This prevents the unit from oscillating around a point it has already passed.
  const consumeRadius = Math.max(6, e.radius * 0.55);
  while (e.path.length > 1) {
    const wp = e.path[0];
    const d = Math.hypot(wp.x - e.x, wp.y - e.y);
    if (d <= consumeRadius) {
      e.path.shift();
      continue;
    }
    // If the next segment starts behind us relative to our heading, skip it
    const toWp = Math.atan2(wp.y - e.y, wp.x - e.x);
    const headingDot = Math.cos(normalizeAngleDiff(toWp, e.angle));
    if (headingDot < -0.25 && d < consumeRadius * 2.8) {
      e.path.shift();
      continue;
    }
    break;
  }

  if (e.path.length === 0) {
    e.isMoving = false;
    e.currentSpeed = 0;
    return true; // arrived
  }

  const remaining = pathLengthFrom(e.path, { x: e.x, y: e.y });
  const finalTarget = e.path[e.path.length - 1];
  const distToFinal = Math.hypot(finalTarget.x - e.x, finalTarget.y - e.y);

  // --- 2. Desired speed (braking + corner slowdown) ---
  const lookAhead = Math.min(
    profile.lookAheadMax,
    Math.max(profile.lookAheadMin, e.currentSpeed * profile.lookAheadTime)
  );

  const turnSeverity = upcomingTurnSeverity(e.path, { x: e.x, y: e.y }, lookAhead);
  const cornerFactor = 1 - turnSeverity * profile.turnSlowdown;

  // Braking distance ≈ v² / (2a). We want to arrive near zero speed.
  const brakeDist = (e.currentSpeed * e.currentSpeed) / (2 * Math.max(0.1, e.speed * profile.brakeFactor * 0.55));
  let desiredSpeed = e.speed * cornerFactor;

  if (remaining < brakeDist + 18) {
    // Ease toward stop
    const t = Math.max(0, remaining / Math.max(brakeDist + 18, 1));
    desiredSpeed = Math.min(desiredSpeed, e.speed * t * t * 0.95 + 4);
  }

  // Final approach: force low speed
  if (distToFinal < 28) {
    desiredSpeed = Math.min(desiredSpeed, Math.max(6, distToFinal * 1.1));
  }

  // --- 3. Accelerate / decelerate ---
  if (e.currentSpeed < desiredSpeed) {
    e.currentSpeed = Math.min(desiredSpeed, e.currentSpeed + e.speed * profile.accelFactor * dt);
  } else {
    e.currentSpeed = Math.max(desiredSpeed, e.currentSpeed - e.speed * profile.brakeFactor * dt);
  }
  e.currentSpeed = Math.max(0, Math.min(e.speed, e.currentSpeed));

  // --- 4. Pure Pursuit steering target ---
  const { point: pursuitPoint } = sampleLookAhead(e.path, { x: e.x, y: e.y }, lookAhead);

  let desiredAngle = e.angle;
  const toPursuitX = pursuitPoint.x - e.x;
  const toPursuitY = pursuitPoint.y - e.y;
  if (Math.hypot(toPursuitX, toPursuitY) > 0.5) {
    desiredAngle = Math.atan2(toPursuitY, toPursuitX);
  }

  // Persons stay upright visually but still translate toward the path
  if (!profile.rotates) {
    e.angle = 0;
  } else {
    const diff = normalizeAngleDiff(desiredAngle, e.angle);
    const maxTurn = e.turnRate * dt;
    e.angle += Math.max(-maxTurn, Math.min(maxTurn, diff));

    // Extra speed reduction when the actual heading error is still large
    const absDiff = Math.abs(diff);
    if (absDiff > 0.35) {
      const headingPenalty = Math.max(0.25, Math.cos(Math.min(absDiff, 1.35)));
      e.currentSpeed *= headingPenalty;
    }
  }

  // --- 5. Integrate position ---
  const step = e.currentSpeed * dt;
  const isLast = e.path.length === 1;
  const capture = isLast
    ? Math.max(step * profile.arrivalSlack, 2.5)
    : Math.max(step * 1.1, 7);

  const distToNext = Math.hypot(e.path[0].x - e.x, e.path[0].y - e.y);

  if (isLast && distToNext <= capture) {
    // Snap to final and finish
    e.x = e.path[0].x;
    e.y = e.path[0].y;
    e.path.shift();
    e.isMoving = false;
    e.currentSpeed = 0;
    e.bankAngle *= 0.5;
    return true;
  }

  // Move: rotating units follow their heading; non-rotating (persons) move directly toward pursuit
  const moveAngle = profile.rotates ? e.angle : desiredAngle;
  const fx = e.x + Math.cos(moveAngle) * step;
  const fy = e.y + Math.sin(moveAngle) * step;

  if (canOccupy(fx, fy, e.domain)) {
    e.x = fx;
    e.y = fy;
  } else {
    // Soft obstacle recovery: try progressive offsets while still respecting domain
    let moved = false;
    const baseAngle = profile.rotates ? e.angle : desiredAngle;
    const offsets = [0.22, -0.22, 0.5, -0.5, 0.9, -0.9, 1.35, -1.35];
    for (const off of offsets) {
      const a = baseAngle + off;
      const nx = e.x + Math.cos(a) * step;
      const ny = e.y + Math.sin(a) * step;
      if (canOccupy(nx, ny, e.domain)) {
        if (profile.rotates) e.angle = a;
        e.x = nx;
        e.y = ny;
        moved = true;
        break;
      }
    }
    if (!moved) {
      // Stuck — bleed speed so we don't jitter
      e.currentSpeed *= 0.35;
    }
  }

  // --- 6. Air banking (visual only) ---
  if (profile.bankStrength > 0) {
    const diff = normalizeAngleDiff(desiredAngle, e.angle);
    const desiredBank = Math.max(-0.42, Math.min(0.42, diff * profile.bankStrength));
    e.bankAngle += (desiredBank - e.bankAngle) * Math.min(1, dt * 5.5);
  } else {
    e.bankAngle *= 0.88;
  }

  return false;
}

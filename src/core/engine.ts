import { findPath } from './pathfinding';
import {
  ActorPack,
  ArrowState,
  CameraTarget,
  EntityState,
  MapPack,
  Order,
  ScenarioFile,
  ScenarioStep,
  SoundId,
  ZoneVisualState
} from './types';

export const TICK_RATE = 30;
export const DT = 1 / TICK_RATE;

export function parseSec(val?: string | number, fallback = 0): number {
  if (val === undefined || val === null) return fallback;
  if (typeof val === 'number') return Number.isFinite(val) ? val : fallback;
  const n = parseFloat(val.replace('s', '').trim());
  return Number.isFinite(n) ? n : fallback;
}

export function normalizeAngleDiff(target: number, current: number): number {
  let d = target - current;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export class StudioEngine {
  public tick = 0;
  public entities = new Map<string, EntityState>();
  public arrows = new Map<string, ArrowState>();
  public zones = new Map<string, ZoneVisualState>();
  public caption = '';
  public cameraTarget: CameraTarget | null = null;

  private executedSteps = new Set<number>();
  private orderQueue: Order[] = [];
  private soundListeners: Array<(id: SoundId) => void> = [];
  private autoCounter = 0;

  constructor(
    public map: MapPack,
    public actors: Record<string, ActorPack>,
    public scenario: ScenarioFile
  ) {
    this.reset();
  }

  onSound(cb: (id: SoundId) => void): () => void {
    this.soundListeners.push(cb);
    return () => {
      this.soundListeners = this.soundListeners.filter((l) => l !== cb);
    };
  }

  private emitSound(id: SoundId): void {
    this.soundListeners.forEach((cb) => cb(id));
  }

  get executedStepCount(): number {
    return this.executedSteps.size;
  }

  get totalStepCount(): number {
    return this.scenario.timeline?.length ?? 0;
  }

  reset(): void {
    this.tick = 0;
    this.entities.clear();
    this.arrows.clear();
    this.zones.clear();
    this.executedSteps.clear();
    this.orderQueue = [];
    this.caption = '';
    this.cameraTarget = { x: this.map.width / 2, y: this.map.height / 2, zoom: 1, durationSec: 0, seq: 0 };
    this.autoCounter = 0;
    for (const z of Object.values(this.map.zones)) {
      this.zones.set(z.id, { id: z.id, color: '#3b82f6', targetOpacity: 0, opacity: 0, rate: 0 });
    }
    this.evaluateTimeline();
    this.processOrders();
  }

  dispatchOrder(order: Order): void {
    this.orderQueue.push(order);
  }

  step(): void {
    this.tick++;
    this.evaluateTimeline();
    this.processOrders();

    // تحديث الكيانات
    for (const e of this.entities.values()) {
      e.prevX = e.x;
      e.prevY = e.y;
      e.prevAngle = e.angle;

      if (e.buildProgress < 1) {
        e.buildProgress = Math.min(1, e.buildProgress + e.buildRate * DT);
        if (e.buildProgress === 1) this.emitSound('build_complete');
        continue;
      }

      if (e.path.length > 0) {
        e.isMoving = true;
        const target = e.path[0];
        const dx = target.x - e.x;
        const dy = target.y - e.y;
        const dist = Math.hypot(dx, dy);

        if (dist > 0.0001) {
          const desiredAngle = Math.atan2(dy, dx);
          const diff = normalizeAngleDiff(desiredAngle, e.angle);
          const maxTurn = e.turnRate * DT;
          e.angle += Math.abs(diff) <= maxTurn ? diff : Math.sign(diff) * maxTurn;
        }

        const moveDist = e.speed * DT;
        if (dist <= moveDist) {
          e.x = target.x;
          e.y = target.y;
          e.path.shift();
          if (e.path.length === 0) {
            e.isMoving = false;
            e.arrivedTick = this.tick;
          }
        } else {
          e.x += (dx / dist) * moveDist;
          e.y += (dy / dist) * moveDist;
        }
      } else {
        e.isMoving = false;
      }
    }

    // تحديث الأسهم التدريجية
    for (const a of this.arrows.values()) {
      if (a.progress < 1) a.progress = Math.min(1, a.progress + a.rate * DT);
    }

    // تحديث تلوين المناطق
    for (const z of this.zones.values()) {
      if (z.opacity !== z.targetOpacity) {
        const diff = z.targetOpacity - z.opacity;
        const step = z.rate * DT;
        z.opacity = Math.abs(diff) <= step ? z.targetOpacity : z.opacity + Math.sign(diff) * step;
      }
    }
  }

  private evaluateTimeline(): void {
    const timeSec = this.tick * DT;
    const steps = this.scenario.timeline ?? [];

    steps.forEach((st, idx) => {
      if (this.executedSteps.has(idx)) return;
      let ready = false;

      if (st.at !== undefined && timeSec >= parseSec(st.at)) {
        ready = true;
      } else if (st.after) {
        const [entityId, event] = st.after.split('.');
        const ent = this.entities.get(entityId);
        if (event === 'arrived' && ent && ent.arrivedTick !== null && !ent.isMoving) {
          ready = true;
        }
      }

      if (ready) {
        this.executedSteps.add(idx);
        this.executeStep(st);
      }
    });
  }

  private executeStep(st: ScenarioStep): void {
    if (st.caption) this.caption = st.caption.text;
    if (st.sound) this.emitSound(st.sound);

    if (st.camera) {
      const anchor = this.map.anchors[st.camera.focus];
      if (anchor) {
        this.cameraTarget = {
          x: anchor.x,
          y: anchor.y,
          zoom: st.camera.zoom ?? 1.4,
          durationSec: parseSec(st.camera.duration, 1.2),
          seq: (this.cameraTarget?.seq ?? 0) + 1
        };
      }
    }

    if (st.spawn) {
      for (const s of st.spawn) {
        const pt = this.map.anchors[s.at];
        if (pt) this.dispatchOrder({ type: 'spawn', id: s.id, actorId: s.actor, at: pt, faction: s.faction ?? 'blue' });
      }
    }

    if (st.move) {
      const pt = this.map.anchors[st.move.to];
      if (pt) this.dispatchOrder({ type: 'move', entityId: st.move.entity, to: pt });
    }

    if (st.construct) {
      const pt = this.map.anchors[st.construct.at];
      if (pt) {
        this.dispatchOrder({
          type: 'construct',
          id: st.construct.id ?? `bld_${++this.autoCounter}`,
          actorId: st.construct.actor,
          at: pt,
          faction: st.construct.faction ?? 'blue',
          durationSec: parseSec(st.construct.duration, 2)
        });
      }
    }

    if (st.draw_arrow) {
      const from = this.map.anchors[st.draw_arrow.from];
      const to = this.map.anchors[st.draw_arrow.to];
      if (from && to) {
        const dur = Math.max(0.1, parseSec(st.draw_arrow.duration, 1.5));
        this.arrows.set(st.draw_arrow.id, {
          id: st.draw_arrow.id,
          from: { ...from },
          to: { ...to },
          color: st.draw_arrow.color ?? '#ef4444',
          dashed: st.draw_arrow.dashed ?? true,
          progress: 0,
          rate: 1 / dur
        });
      }
    }

    if (st.zone) {
      const z = this.zones.get(st.zone.id);
      if (z) {
        const dur = Math.max(0.1, parseSec(st.zone.duration, 1.2));
        z.color = st.zone.color;
        z.targetOpacity = st.zone.opacity ?? 0.35;
        z.rate = Math.abs(z.targetOpacity - z.opacity) / dur || 1;
      }
    }
  }

  private processOrders(): void {
    while (this.orderQueue.length > 0) {
      const ord = this.orderQueue.shift()!;
      if (ord.type === 'spawn') {
        const act = this.actors[ord.actorId];
        if (!act) continue;
        this.entities.set(ord.id, {
          id: ord.id,
          actorId: ord.actorId,
          kind: act.kind,
          domain: act.domain,
          faction: ord.faction,
          x: ord.at.x,
          y: ord.at.y,
          prevX: ord.at.x,
          prevY: ord.at.y,
          angle: 0,
          prevAngle: 0,
          path: [],
          speed: act.speed,
          turnRate: act.turnRate,
          scale: act.scale,
          radius: act.radius,
          buildProgress: 1,
          buildRate: 1,
          isMoving: false,
          arrivedTick: null
        });
        this.emitSound('spawn_pop');
      } else if (ord.type === 'construct') {
        const act = this.actors[ord.actorId];
        if (!act) continue;
        this.entities.set(ord.id, {
          id: ord.id,
          actorId: ord.actorId,
          kind: 'building',
          domain: 'land',
          faction: ord.faction,
          x: ord.at.x,
          y: ord.at.y,
          prevX: ord.at.x,
          prevY: ord.at.y,
          angle: 0,
          prevAngle: 0,
          path: [],
          speed: 0,
          turnRate: 0,
          scale: act.scale,
          radius: act.radius,
          buildProgress: 0,
          buildRate: 1 / Math.max(0.2, ord.durationSec),
          isMoving: false,
          arrivedTick: null
        });
      } else if (ord.type === 'move') {
        const ent = this.entities.get(ord.entityId);
        if (!ent || ent.kind === 'building') continue;
        ent.arrivedTick = null;
        ent.path = findPath(this.map, { x: ent.x, y: ent.y }, ord.to, ent.domain);
        this.emitSound('move_order');
      }
    }
  }
}

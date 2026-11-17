import { findPath, isWalkable } from './pathfinding';
import {
  ActorPack,
  ArrowState,
  CalloutState,
  CameraTarget,
  CraterDecal,
  Domain,
  EntityState,
  ExplosionState,
  Faction,
  MapPack,
  Order,
  Point,
  PointRef,
  ProjectileState,
  PulseState,
  ScenarioFile,
  ScenarioStep,
  SoundId,
  ZoneVisualState
} from './types';

function resolvePoint(map: MapPack, ref: PointRef | undefined): Point | undefined {
  if (!ref) return undefined;
  if (typeof ref === 'string') return map.anchors[ref];
  if (typeof ref.x === 'number' && typeof ref.y === 'number') return ref;
  return undefined;
}

export const TICK_RATE = 30;
export const DT = 1 / TICK_RATE;

const STRICT_SEC_RE = /^(?:\d+(?:\.\d+)?|\.\d+)(?:\s*s)?$/i;

export function parseStrictSec(val: unknown): number | null {
  if (typeof val === 'number') {
    return Number.isFinite(val) && val >= 0 ? val : null;
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed || !STRICT_SEC_RE.test(trimmed)) return null;
    const numericPart = trimmed.replace(/\s*s$/i, '');
    const n = Number(numericPart);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  return null;
}

export function parseSec(val?: string | number, fallback = 0): number {
  if (val === undefined || val === null) return Math.max(0, fallback);
  const parsed = parseStrictSec(val);
  return parsed !== null ? parsed : Math.max(0, fallback);
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
  public callouts = new Map<string, CalloutState>();
  public pulses: PulseState[] = [];
  public projectiles: ProjectileState[] = [];
  public explosions: ExplosionState[] = [];
  public craters: CraterDecal[] = [];
  public caption = '';
  public cameraTarget: CameraTarget | null = null;

  private executedSteps = new Set<number>();
  private orderQueue: Order[] = [];
  private soundListeners: Array<(id: SoundId) => void> = [];
  private blockedListeners: Array<(entity: EntityState) => void> = [];
  private autoCounter = 0;
  private constructAutoSeq = 0;
  private reservedExplicitIds = new Set<string>();
  private usedAutoIds = new Set<string>();
  private silent = false;

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

  onMoveBlocked(cb: (entity: EntityState) => void): () => void {
    this.blockedListeners.push(cb);
    return () => {
      this.blockedListeners = this.blockedListeners.filter((l) => l !== cb);
    };
  }

  private emitSound(id: SoundId): void {
    if (this.silent) return;
    this.soundListeners.forEach((cb) => cb(id));
  }

  get executedStepCount(): number {
    return this.executedSteps.size;
  }

  get totalStepCount(): number {
    return Array.isArray(this.scenario.timeline) ? this.scenario.timeline.length : 0;
  }

  estimateDurationSec(): number {
    const hint = parseStrictSec(this.scenario.meta?.duration_hint);
    let maxAt = Math.max(18, hint ?? 18);
    const steps = Array.isArray(this.scenario.timeline) ? this.scenario.timeline : [];
    for (const st of steps) {
      if (st?.at !== undefined) {
        const atSec = parseStrictSec(st.at);
        if (atSec !== null) maxAt = Math.max(maxAt, atSec + 8);
      }
    }
    return maxAt;
  }

  seekToTick(targetTick: number): void {
    const clamped = Math.max(0, Math.floor(targetTick));
    const prevSilent = this.silent;
    this.silent = true;
    try {
      if (clamped < this.tick) this.reset();
      while (this.tick < clamped) this.step();
    } finally {
      this.silent = prevSilent;
    }
  }

  private collectReservedExplicitIds(): Set<string> {
    const reserved = new Set<string>();
    const steps = Array.isArray(this.scenario.timeline) ? this.scenario.timeline : [];
    for (const st of steps) {
      if (!st || typeof st !== 'object') continue;
      if (Array.isArray(st.spawn)) {
        for (const s of st.spawn) {
          if (s && typeof s.id === 'string' && s.id.trim()) {
            reserved.add(s.id.trim());
          }
        }
      }
      if (st.construct && typeof st.construct.id === 'string' && st.construct.id.trim()) {
        reserved.add(st.construct.id.trim());
      }
    }
    return reserved;
  }

  reset(): void {
    this.tick = 0;
    this.entities.clear();
    this.arrows.clear();
    this.zones.clear();
    this.callouts.clear();
    this.pulses = [];
    this.projectiles = [];
    this.explosions = [];
    this.craters = [];
    this.executedSteps.clear();
    this.orderQueue = [];
    this.caption = '';
    this.cameraTarget = { x: this.map.width / 2, y: this.map.height / 2, zoom: 1, durationSec: 0, seq: 0 };
    this.autoCounter = 0;
    this.constructAutoSeq = 0;
    this.usedAutoIds.clear();
    this.reservedExplicitIds = this.collectReservedExplicitIds();
    for (const z of Object.values(this.map.zones)) {
      this.zones.set(z.id, { id: z.id, color: '#3b82f6', targetOpacity: 0, opacity: 0, rate: 0 });
    }
    this.evaluateTimeline();
    this.processOrders();
  }

  dispatchOrder(order: Order): void {
    this.orderQueue.push(order);
  }

  flushOrders(): void {
    this.processOrders();
  }

  private triggerExplosion(
    x: number,
    y: number,
    maxRadius: number,
    kind: 'airstrike' | 'missile',
    color: string,
    attackerFaction: Faction
  ): void {
    this.explosions.push({
      id: `exp_${++this.autoCounter}`,
      x,
      y,
      maxRadius,
      progress: 0,
      color,
      kind
    });
    this.pulses.push({ x, y, color, maxRadius: maxRadius * 1.25, progress: 0 });
    this.craters.push({
      x,
      y,
      radius: Math.max(8, Math.min(28, maxRadius * 0.34)),
      life: 7.5,
      maxLife: 7.5
    });
    if (this.craters.length > 60) this.craters.shift();
    this.emitSound('explosion');

    // تدمير الوحدات أو المنشآت المعادية/المحايدة ضمن نطاق الانفجار
    const hitIds: string[] = [];
    for (const ent of this.entities.values()) {
      if (ent.kind === 'air' && ent.altitude > 0.35) continue;
      if (ent.faction === attackerFaction) continue;
      if (Math.hypot(ent.x - x, ent.y - y) <= maxRadius + ent.radius * 0.6) {
        hitIds.push(ent.id);
      }
    }
    for (const id of hitIds) {
      this.removeEntityWithCallouts(id);
    }
  }

  private removeEntityWithCallouts(entityId: string): void {
    this.entities.delete(entityId);
    for (const [cid, c] of this.callouts) {
      if (c.target === entityId && !this.map.anchors[c.target]) {
        this.callouts.delete(cid);
      }
    }
  }

  private isWorldPointWalkable(x: number, y: number, domain: Domain): boolean {
    if (domain === 'air') return true;
    const gx = Math.floor(x / this.map.cellSize);
    const gy = Math.floor(y / this.map.cellSize);
    if (gx < 0 || gy < 0 || gx >= this.map.cols || gy >= this.map.rows) return false;
    return isWalkable(this.map.navGrid[gy * this.map.cols + gx], domain);
  }

  step(): void {
    this.tick++;
    this.evaluateTimeline();
    this.processOrders();

    for (const e of this.entities.values()) {
      e.prevX = e.x;
      e.prevY = e.y;
      e.prevAngle = e.angle;
      e.prevAltitude = e.altitude;

      if (e.buildProgress < 1) {
        e.buildProgress = Math.min(1, e.buildProgress + e.buildRate * DT);
        if (e.buildProgress >= 1) {
          e.buildProgress = 1;
          e.builtTick = this.tick;
          this.emitSound('build_complete');
        }
        continue;
      }

      if (e.path.length > 0) {
        e.isMoving = true;
        const target = e.path[0];
        const dx = target.x - e.x;
        const dy = target.y - e.y;
        const dist = Math.hypot(dx, dy);

        // تسارع وانسيابية في السرعة
        const targetSpeed = e.speed;
        const accel = e.kind === 'air' ? e.speed * 2.4 : e.speed * 3.5;
        e.currentSpeed = Math.min(targetSpeed, e.currentSpeed + accel * DT);

        // إقلاع الطائرات تدريجيًا عند التحليق
        if (e.kind === 'air') {
          const remainDist = Math.hypot(
            e.path[e.path.length - 1].x - e.x,
            e.path[e.path.length - 1].y - e.y
          );
          const wantAlt = e.pendingStrike ? 1 : remainDist < 48 ? Math.max(0.15, remainDist / 48) : 1;
          e.altitude += (wantAlt - e.altitude) * Math.min(1, DT * 3.2);
        }

        let turnThrottle = 1;
        if (dist > 0.0001) {
          const desiredAngle = Math.atan2(dy, dx);
          if (e.kind === 'person') {
            // المشاة والمبعوث يبقون بوضعية عمودية سليمة دون انقلاب
            e.angle = 0;
            e.bankAngle = 0;
          } else {
            const diff = normalizeAngleDiff(desiredAngle, e.angle);
            const maxTurn = e.turnRate * DT;
            const stepAngle = Math.abs(diff) <= maxTurn ? diff : Math.sign(diff) * maxTurn;
            e.angle += stepAngle;

            if (e.kind === 'air') {
              const desiredBank = Math.max(-0.42, Math.min(0.42, diff * 0.65));
              e.bankAngle += (desiredBank - e.bankAngle) * Math.min(1, DT * 5);
              if (Math.abs(diff) > 0.65 && dist < 130) {
                turnThrottle = Math.max(0.55, Math.cos(Math.min(Math.PI * 0.42, Math.abs(diff) * 0.7)));
              }
            } else {
              // السفن والمدرعات تخفف سرعتها داخل المنعطفات الحادة لتنعطف بقوس حقيقي بدون شقلبة
              turnThrottle = Math.max(0.28, Math.cos(Math.min(Math.PI * 0.45, Math.abs(diff))));
            }
          }
        }

        const moveDist = e.currentSpeed * turnThrottle * DT;
        const wpCaptureRadius = e.path.length > 1 ? Math.max(moveDist, e.kind === 'air' ? 24 : 12) : moveDist;
        if (dist <= wpCaptureRadius) {
          e.x = target.x;
          e.y = target.y;
          e.path.shift();
          if (e.path.length === 0) {
            e.isMoving = false;
            e.currentSpeed = 0;
            e.arrivedTick = this.tick;
          }
        } else {
          // للكيانات المتحركة بالاتجاه الأمامي (طائرات/سفن/مركبات)، نمزج الحركة مع متجه الهدف بدقة لمنع الدوران اللانهائي
          const ux = dx / dist;
          const uy = dy / dist;
          if (e.kind === 'person' || dist < 18) {
            const nx = e.x + ux * moveDist;
            const ny = e.y + uy * moveDist;
            if (
              e.domain === 'air' ||
              this.isWorldPointWalkable(nx, ny, e.domain) ||
              !this.isWorldPointWalkable(e.x, e.y, e.domain)
            ) {
              e.x = nx;
              e.y = ny;
            }
          } else {
            const hx = Math.cos(e.angle);
            const hy = Math.sin(e.angle);
            const blend = dist < 55 ? 0.68 : 0.34;
            const mx = hx * (1 - blend) + ux * blend;
            const my = hy * (1 - blend) + uy * blend;
            const mLen = Math.hypot(mx, my) || 1;
            const candX = e.x + (mx / mLen) * moveDist;
            const candY = e.y + (my / mLen) * moveDist;
            if (
              e.domain === 'air' ||
              this.isWorldPointWalkable(candX, candY, e.domain) ||
              !this.isWorldPointWalkable(e.x, e.y, e.domain)
            ) {
              e.x = candX;
              e.y = candY;
            } else {
              // منع السفينة أو المركبة من الخروج أثناء الانعطاف فوق اليابسة أو العوائق
              const directX = e.x + ux * moveDist;
              const directY = e.y + uy * moveDist;
              const desired = Math.atan2(dy, dx);
              e.angle += normalizeAngleDiff(desired, e.angle) * Math.min(1, DT * 7);
              if (this.isWorldPointWalkable(directX, directY, e.domain)) {
                e.x = directX;
                e.y = directY;
              }
            }
          }
        }

        // إطلاق القذيفة عند وصول الطائرة فوق هدف القصف ثم الالتفاف بقوس واسع والعودة للقاعدة للهبوط
        if (e.pendingStrike) {
          const dStrike = Math.hypot(e.pendingStrike.to.x - e.x, e.pendingStrike.to.y - e.y);
          if (dStrike <= Math.max(28, Math.min(44, e.pendingStrike.radius * 0.5)) || e.path.length === 0) {
            const st = e.pendingStrike;
            e.pendingStrike = null;
            this.projectiles.push({
              id: `proj_${++this.autoCounter}`,
              mode: 'bomb',
              x: e.x,
              y: e.y,
              prevX: e.x,
              prevY: e.y,
              startX: e.x,
              startY: e.y,
              targetX: st.to.x,
              targetY: st.to.y,
              altitude: e.altitude,
              progress: 0,
              durationSec: 0.42,
              radius: st.radius,
              color: st.color,
              faction: e.faction
            });

            // نقطة عبور بعد الهدف + قوس التفاف واسع باتجاه القاعدة ثم العودة إلى نقطة الانطلاق
            const clampX = (vx: number) => Math.max(28, Math.min(this.map.width - 28, vx));
            const clampY = (vy: number) => Math.max(28, Math.min(this.map.height - 28, vy));
            const flyPast = {
              x: clampX(st.to.x + Math.cos(e.angle) * 72),
              y: clampY(st.to.y + Math.sin(e.angle) * 72)
            };
            const perpLx = -Math.sin(e.angle);
            const perpLy = Math.cos(e.angle);
            const toHomeX = st.returnTo.x - flyPast.x;
            const toHomeY = st.returnTo.y - flyPast.y;
            const side = toHomeX * perpLx + toHomeY * perpLy >= 0 ? 1 : -1;
            const turnWing = {
              x: clampX(flyPast.x + perpLx * side * 96 - Math.cos(e.angle) * 28),
              y: clampY(flyPast.y + perpLy * side * 96 - Math.sin(e.angle) * 28)
            };
            e.path = [flyPast, turnWing, { ...st.returnTo }];
            e.isMoving = true;
          }
        }
      } else {
        e.isMoving = false;
        e.currentSpeed = 0;
        e.bankAngle *= 0.85;
        // هبوط الطائرة بسلاسة عند القاعدة بعد العودة
        if (e.kind === 'air' && e.altitude > 0) {
          e.altitude = Math.max(0, e.altitude - DT * 2.2);
        }
      }
    }

    // تلاشي آثار وسواد القصف تدريجيًا بعد بقائها لفترة وجيزة
    for (const c of this.craters) {
      c.life -= DT;
    }
    this.craters = this.craters.filter((c) => c.life > 0);

    // تحديث الصواريخ والقنابل
    const nextProjectiles: ProjectileState[] = [];
    for (const p of this.projectiles) {
      p.prevX = p.x;
      p.prevY = p.y;
      p.progress = Math.min(1, p.progress + DT / Math.max(0.15, p.durationSec));
      p.x = p.startX + (p.targetX - p.startX) * p.progress;
      p.y = p.startY + (p.targetY - p.startY) * p.progress;
      p.altitude = p.mode === 'missile' ? Math.sin(p.progress * Math.PI) * 1.65 : (1 - p.progress) * 0.9;

      if (p.progress >= 1) {
        this.triggerExplosion(
          p.targetX,
          p.targetY,
          p.radius,
          p.mode === 'missile' ? 'missile' : 'airstrike',
          p.color,
          p.faction
        );
      } else {
        nextProjectiles.push(p);
      }
    }
    this.projectiles = nextProjectiles;

    // تحديث الانفجارات التفاعلية
    for (const ex of this.explosions) {
      ex.progress += DT * (ex.kind === 'missile' ? 0.95 : 1.15);
    }
    this.explosions = this.explosions.filter((ex) => ex.progress < 1);

    for (const a of this.arrows.values()) {
      if (a.progress < 1) a.progress = Math.min(1, a.progress + a.rate * DT);
    }

    for (const z of this.zones.values()) {
      if (z.opacity !== z.targetOpacity) {
        const diff = z.targetOpacity - z.opacity;
        const step = z.rate * DT;
        z.opacity = Math.abs(diff) <= step ? z.targetOpacity : z.opacity + Math.sign(diff) * step;
      }
    }

    for (const [id, c] of this.callouts) {
      if (c.remainingTicks !== null) {
        c.remainingTicks--;
        if (c.remainingTicks <= 0) this.callouts.delete(id);
      }
    }

    for (const p of this.pulses) {
      p.progress += DT * 0.9;
    }
    this.pulses = this.pulses.filter((p) => p.progress < 1);
  }

  private evaluateTimeline(): void {
    const timeSec = this.tick * DT;
    const steps = Array.isArray(this.scenario.timeline) ? this.scenario.timeline : [];

    steps.forEach((st, idx) => {
      if (!st || this.executedSteps.has(idx)) return;
      let ready = false;

      if (st.at !== undefined) {
        const atSec = parseStrictSec(st.at);
        if (atSec !== null && timeSec >= atSec) {
          ready = true;
        }
      } else if (typeof st.after === 'string') {
        const dotIdx = st.after.indexOf('.');
        const entityId = dotIdx > 0 ? st.after.slice(0, dotIdx) : '';
        const event = dotIdx > 0 ? st.after.slice(dotIdx + 1) : '';
        const ent = entityId ? this.entities.get(entityId) : undefined;
        if (event === 'arrived' && ent && ent.arrivedTick !== null && !ent.isMoving) {
          ready = true;
        } else if (event === 'built' && ent && ent.builtTick !== null && ent.buildProgress >= 1) {
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
      const anchor = resolvePoint(this.map, st.camera.focus);
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
        const pt = resolvePoint(this.map, s.at);
        if (pt) {
          this.dispatchOrder({
            type: 'spawn',
            id: s.id,
            actorId: s.actor,
            at: pt,
            faction: s.faction ?? 'blue',
            scale: s.scale
          });
        }
      }
    }

    if (st.move) {
      const pt = resolvePoint(this.map, st.move.to);
      if (pt) this.dispatchOrder({ type: 'move', entityId: st.move.entity, to: pt });
    }

    if (st.resize) {
      this.dispatchOrder({ type: 'resize', entityId: st.resize.entity, scale: st.resize.scale });
    }

    if (st.remove) {
      this.dispatchOrder({ type: 'remove', entityId: st.remove.entity });
    }

    if (st.construct) {
      const pt = resolvePoint(this.map, st.construct.at);
      if (pt) {
        let constructId = st.construct.id;
        if (constructId === undefined) {
          do {
            constructId = `bld_${++this.constructAutoSeq}`;
          } while (
            this.reservedExplicitIds.has(constructId) ||
            this.entities.has(constructId) ||
            this.usedAutoIds.has(constructId)
          );
          this.usedAutoIds.add(constructId);
        }
        this.dispatchOrder({
          type: 'construct',
          id: constructId,
          actorId: st.construct.actor,
          at: pt,
          faction: st.construct.faction ?? 'blue',
          durationSec: parseSec(st.construct.duration, 2),
          scale: st.construct.scale
        });
      }
    }

    if (st.strike) {
      const to = resolvePoint(this.map, st.strike.to);
      const from = resolvePoint(this.map, st.strike.from);
      if (to) {
        this.dispatchOrder({
          type: 'strike',
          attackerId: st.strike.attacker,
          mode: st.strike.mode ?? 'missile',
          from,
          to,
          radius: st.strike.radius,
          color: st.strike.color
        });
      }
    }

    if (st.draw_arrow) {
      const from = resolvePoint(this.map, st.draw_arrow.from);
      const to = resolvePoint(this.map, st.draw_arrow.to);
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

    if (st.callout) {
      const dur = st.callout.duration ? Math.round(parseSec(st.callout.duration) * TICK_RATE) : null;
      this.callouts.set(st.callout.id, {
        id: st.callout.id,
        target: st.callout.target,
        text: st.callout.text,
        color: st.callout.color ?? '#0ea5e9',
        remainingTicks: dur
      });
    }

    if (st.pulse) {
      const pt = resolvePoint(this.map, st.pulse.at);
      if (pt) {
        this.pulses.push({
          x: pt.x,
          y: pt.y,
          color: st.pulse.color ?? '#ef4444',
          maxRadius: st.pulse.radius ?? 75,
          progress: 0
        });
      }
    }
  }

  private processOrders(): void {
    while (this.orderQueue.length > 0) {
      const ord = this.orderQueue.shift()!;
      if (ord.type === 'spawn') {
        if (!ord.id || typeof ord.id !== 'string' || !ord.id.trim() || this.entities.has(ord.id)) continue;
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
          currentSpeed: 0,
          altitude: 0,
          prevAltitude: 0,
          bankAngle: 0,
          path: [],
          speed: act.speed,
          turnRate: act.turnRate,
          scale: act.scale,
          scaleMul: ord.scale !== undefined ? Math.max(0.25, Math.min(3.5, ord.scale)) : 1,
          radius: act.radius,
          buildProgress: 1,
          buildRate: 1,
          isMoving: false,
          arrivedTick: null,
          builtTick: null,
          homeX: ord.at.x,
          homeY: ord.at.y,
          pendingStrike: null
        });
        this.emitSound('spawn_pop');
      } else if (ord.type === 'construct') {
        if (!ord.id || typeof ord.id !== 'string' || !ord.id.trim() || this.entities.has(ord.id)) continue;
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
          currentSpeed: 0,
          altitude: 0,
          prevAltitude: 0,
          bankAngle: 0,
          path: [],
          speed: 0,
          turnRate: 0,
          scale: act.scale,
          scaleMul: ord.scale !== undefined ? Math.max(0.25, Math.min(3.5, ord.scale)) : 1,
          radius: act.radius,
          buildProgress: 0,
          buildRate: 1 / Math.max(0.2, ord.durationSec),
          isMoving: false,
          arrivedTick: null,
          builtTick: null,
          homeX: ord.at.x,
          homeY: ord.at.y,
          pendingStrike: null
        });
      } else if (ord.type === 'resize') {
        const ent = this.entities.get(ord.entityId);
        if (ent && Number.isFinite(ord.scale)) {
          ent.scaleMul = Math.max(0.25, Math.min(3.5, ord.scale));
        }
      } else if (ord.type === 'move') {
        const ent = this.entities.get(ord.entityId);
        if (!ent || ent.kind === 'building') continue;
        const path = findPath(this.map, { x: ent.x, y: ent.y }, ord.to, ent.domain);
        if (path.length === 0) {
          if (!this.silent) this.blockedListeners.forEach((cb) => cb(ent));
          continue;
        }
        ent.arrivedTick = null;
        ent.pendingStrike = null;
        ent.path = path;
        if (ent.kind === 'air') {
          ent.homeX = ord.to.x;
          ent.homeY = ord.to.y;
          this.emitSound('jet_takeoff');
        } else if (ent.kind === 'ship') this.emitSound('ship_horn');
        else this.emitSound('move_order');
      } else if (ord.type === 'strike') {
        const radius = ord.radius ?? (ord.mode === 'missile' ? 78 : 62);
        const color = ord.color ?? (ord.mode === 'missile' ? '#f97316' : '#ef4444');
        const attacker = ord.attackerId ? this.entities.get(ord.attackerId) : undefined;
        const faction = ord.faction ?? attacker?.faction ?? 'blue';

        if (ord.mode === 'airstrike' && attacker && attacker.kind === 'air') {
          if (attacker.altitude < 0.15) {
            attacker.homeX = attacker.x;
            attacker.homeY = attacker.y;
          }
          attacker.arrivedTick = null;
          attacker.pendingStrike = {
            to: { ...ord.to },
            radius,
            mode: 'airstrike',
            color,
            returnTo: { x: attacker.homeX, y: attacker.homeY }
          };
          attacker.path = [{ ...ord.to }];
          this.emitSound('jet_takeoff');
        } else {
          const launchPt =
            ord.from ??
            (attacker ? { x: attacker.x, y: attacker.y } : { x: Math.max(30, ord.to.x - 160), y: Math.min(this.map.height - 30, ord.to.y + 110) });
          if (attacker && Math.hypot(ord.to.x - attacker.x, ord.to.y - attacker.y) > 4) {
            attacker.angle = Math.atan2(ord.to.y - attacker.y, ord.to.x - attacker.x);
          }
          const dist = Math.hypot(ord.to.x - launchPt.x, ord.to.y - launchPt.y);
          const dur = ord.mode === 'missile' ? Math.max(0.85, Math.min(2.6, dist / 240)) : Math.max(0.45, Math.min(1.2, dist / 320));
          this.projectiles.push({
            id: `proj_${++this.autoCounter}`,
            mode: ord.mode === 'missile' ? 'missile' : 'bomb',
            x: launchPt.x,
            y: launchPt.y,
            prevX: launchPt.x,
            prevY: launchPt.y,
            startX: launchPt.x,
            startY: launchPt.y,
            targetX: ord.to.x,
            targetY: ord.to.y,
            altitude: 0.1,
            progress: 0,
            durationSec: dur,
            radius,
            color,
            faction
          });
          this.emitSound(ord.mode === 'missile' ? 'missile_launch' : 'jet_takeoff');
        }
      } else if (ord.type === 'remove') {
        this.removeEntityWithCallouts(ord.entityId);
      }
    }
  }
}

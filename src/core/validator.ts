import { ActorPack, MapPack, PointRef, ScenarioFile, ValidationIssue } from './types';

function closestKey(target: string, keys: string[]): string | null {
  let best: string | null = null;
  let bestScore = Infinity;
  for (const k of keys) {
    let diff = Math.abs(k.length - target.length);
    const minL = Math.min(k.length, target.length);
    for (let i = 0; i < minL; i++) if (k[i] !== target[i]) diff++;
    if (diff < bestScore && diff <= 4) {
      bestScore = diff;
      best = k;
    }
  }
  return best;
}

const VALID_FACTIONS = new Set(['blue', 'red', 'neutral']);
const VALID_SOUNDS = new Set([
  'build_complete',
  'alert_ping',
  'move_order',
  'spawn_pop',
  'jet_takeoff',
  'missile_launch',
  'explosion',
  'ship_horn'
]);

export function validateScenario(
  scenario: ScenarioFile,
  map: MapPack | undefined,
  actors: Record<string, ActorPack>
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!scenario || typeof scenario !== 'object' || Array.isArray(scenario)) {
    issues.push({ stepIndex: -1, field: 'root', message: 'ملف السيناريو يجب أن يكون كائن YAML صالحًا' });
    return issues;
  }
  if (!scenario.meta?.map) {
    issues.push({ stepIndex: -1, field: 'meta.map', message: 'يجب تحديد اسم الخريطة في meta.map' });
    return issues;
  }
  if (!map) {
    issues.push({ stepIndex: -1, field: 'meta.map', message: `الخريطة "${scenario.meta.map}" غير موجودة في قاعدة البيانات` });
    return issues;
  }
  if (scenario.timeline !== undefined && !Array.isArray(scenario.timeline)) {
    issues.push({ stepIndex: -1, field: 'timeline', message: 'timeline يجب أن يكون قائمة من الخطوات' });
    return issues;
  }

  const anchorKeys = Object.keys(map.anchors);
  const zoneKeys = Object.keys(map.zones);
  const actorKeys = Object.keys(actors);
  const spawnedIds = new Set<string>();

  const checkPointRef = (stepIdx: number, field: string, ref: PointRef | undefined) => {
    if (!ref) {
      issues.push({ stepIndex: stepIdx, field, message: 'الموضع مفقود' });
      return;
    }
    if (typeof ref === 'string') {
      if (!map.anchors[ref]) {
        const hint = closestKey(ref, anchorKeys);
        issues.push({
          stepIndex: stepIdx,
          field,
          message: `نقطة غير معروفة "${ref}"${hint ? ` — هل تقصد "${hint}"؟` : ''}`
        });
      }
    } else if (typeof ref.x !== 'number' || typeof ref.y !== 'number' || !Number.isFinite(ref.x) || !Number.isFinite(ref.y)) {
      issues.push({ stepIndex: stepIdx, field, message: 'الإحداثيات {x, y} غير صالحة' });
    }
  };

  const checkActor = (stepIdx: number, field: string, name: string) => {
    if (!actors[name]) {
      const hint = closestKey(name, actorKeys);
      issues.push({
        stepIndex: stepIdx,
        field,
        message: `كيان غير معروف "${name}"${hint ? ` — هل تقصد "${hint}"؟` : ''}`
      });
    }
  };

  (scenario.timeline ?? []).forEach((step, idx) => {
    if (!step || typeof step !== 'object') {
      issues.push({ stepIndex: idx, field: 'step', message: 'الخطوة فارغة أو غير صالحة' });
      return;
    }
    if (!step.at && !step.after) {
      issues.push({ stepIndex: idx, field: 'at/after', message: 'كل خطوة تحتاج توقيت at أو محفز after' });
    }
    if (step.after) {
      const [entId, ev] = String(step.after).split('.');
      if (!entId || ev !== 'arrived' || !spawnedIds.has(entId)) {
        issues.push({
          stepIndex: idx,
          field: 'after',
          message: `محفز after "${step.after}" يجب أن يكون بصيغة "<entityId>.arrived" لوحدة مُنشأة مسبقًا`
        });
      }
    }
    if (step.sound !== undefined && !VALID_SOUNDS.has(step.sound)) {
      issues.push({ stepIndex: idx, field: 'sound', message: `صوت غير معروف "${step.sound}"` });
    }
    if (step.camera) checkPointRef(idx, 'camera.focus', step.camera.focus);
    if (step.spawn) {
      if (!Array.isArray(step.spawn)) {
        issues.push({ stepIndex: idx, field: 'spawn', message: 'spawn يجب أن يكون قائمة وحدات' });
      } else {
        for (const s of step.spawn) {
          spawnedIds.add(s.id);
          checkActor(idx, 'spawn.actor', s.actor);
          checkPointRef(idx, 'spawn.at', s.at);
          if (s.faction !== undefined && !VALID_FACTIONS.has(s.faction)) {
            issues.push({ stepIndex: idx, field: 'spawn.faction', message: `فصيل غير معروف "${s.faction}"` });
          }
          if (s.scale !== undefined && (typeof s.scale !== 'number' || !Number.isFinite(s.scale) || s.scale < 0.2 || s.scale > 4)) {
            issues.push({ stepIndex: idx, field: 'spawn.scale', message: 'معامل الحجم scale يجب أن يكون رقمًا بين 0.2 و 4' });
          }
        }
      }
    }
    if (step.pulse) checkPointRef(idx, 'pulse.at', step.pulse.at);
    if (step.move) {
      if (!spawnedIds.has(step.move.entity)) {
        issues.push({ stepIndex: idx, field: 'move.entity', message: `الوحدة "${step.move.entity}" لم تُنشأ قبل هذا الأمر` });
      }
      checkPointRef(idx, 'move.to', step.move.to);
    }
    if (step.resize) {
      if (!spawnedIds.has(step.resize.entity)) {
        issues.push({ stepIndex: idx, field: 'resize.entity', message: `الوحدة "${step.resize.entity}" لم تُنشأ قبل تغيير حجمها` });
      }
      if (typeof step.resize.scale !== 'number' || !Number.isFinite(step.resize.scale) || step.resize.scale < 0.2 || step.resize.scale > 4) {
        issues.push({ stepIndex: idx, field: 'resize.scale', message: 'معامل الحجم scale يجب أن يكون رقمًا بين 0.2 و 4' });
      }
    }
    if (step.remove && !spawnedIds.has(step.remove.entity)) {
      issues.push({ stepIndex: idx, field: 'remove.entity', message: `الوحدة "${step.remove.entity}" غير موجودة للإزالة` });
    }
    if (step.construct) {
      if (step.construct.id) spawnedIds.add(step.construct.id);
      checkActor(idx, 'construct.actor', step.construct.actor);
      checkPointRef(idx, 'construct.at', step.construct.at);
      if (step.construct.faction !== undefined && !VALID_FACTIONS.has(step.construct.faction)) {
        issues.push({ stepIndex: idx, field: 'construct.faction', message: `فصيل غير معروف "${step.construct.faction}"` });
      }
      if (step.construct.scale !== undefined && (typeof step.construct.scale !== 'number' || !Number.isFinite(step.construct.scale) || step.construct.scale < 0.2 || step.construct.scale > 4)) {
        issues.push({ stepIndex: idx, field: 'construct.scale', message: 'معامل الحجم scale يجب أن يكون رقمًا بين 0.2 و 4' });
      }
    }
    if (step.draw_arrow) {
      checkPointRef(idx, 'draw_arrow.from', step.draw_arrow.from);
      checkPointRef(idx, 'draw_arrow.to', step.draw_arrow.to);
    }
    if (step.zone && !map.zones[step.zone.id]) {
      const hint = closestKey(step.zone.id, zoneKeys);
      issues.push({
        stepIndex: idx,
        field: 'zone.id',
        message: `منطقة غير معروفة "${step.zone.id}"${hint ? ` — هل تقصد "${hint}"؟` : ''}`
      });
    }
    if (step.callout) {
      const t = step.callout.target;
      if (!map.anchors[t] && !spawnedIds.has(t)) {
        issues.push({
          stepIndex: idx,
          field: 'callout.target',
          message: `الهدف "${t}" ليس مرسى في الخريطة ولا وحدة منشأة`
        });
      }
    }
    if (step.strike) {
      if (step.strike.mode !== 'airstrike' && step.strike.mode !== 'missile') {
        issues.push({
          stepIndex: idx,
          field: 'strike.mode',
          message: 'نوع الضربة يجب أن يكون airstrike أو missile'
        });
      }
      if (step.strike.attacker !== undefined && !spawnedIds.has(step.strike.attacker)) {
        issues.push({
          stepIndex: idx,
          field: 'strike.attacker',
          message: `الوحدة المهاجمة "${step.strike.attacker}" غير منشأة مسبقًا`
        });
      }
      if (step.strike.from !== undefined) {
        checkPointRef(idx, 'strike.from', step.strike.from);
      }
      checkPointRef(idx, 'strike.to', step.strike.to);
    }
  });

  return issues;
}

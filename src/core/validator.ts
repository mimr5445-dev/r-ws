import { ActorPack, MapPack, ScenarioFile, ValidationIssue } from './types';

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

export function validateScenario(
  scenario: ScenarioFile,
  map: MapPack | undefined,
  actors: Record<string, ActorPack>
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!scenario?.meta?.map) {
    issues.push({ stepIndex: -1, field: 'meta.map', message: 'يجب تحديد اسم الخريطة في meta.map' });
    return issues;
  }
  if (!map) {
    issues.push({ stepIndex: -1, field: 'meta.map', message: `الخريطة "${scenario.meta.map}" غير موجودة في الحزم` });
    return issues;
  }

  const anchorKeys = Object.keys(map.anchors);
  const zoneKeys = Object.keys(map.zones);
  const actorKeys = Object.keys(actors);
  const spawnedIds = new Set<string>();

  const checkAnchor = (stepIdx: number, field: string, name: string) => {
    if (!map.anchors[name]) {
      const hint = closestKey(name, anchorKeys);
      issues.push({
        stepIndex: stepIdx,
        field,
        message: `نقطة غير معروفة "${name}"${hint ? ` — هل تقصد "${hint}"؟` : ''}`
      });
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
    if (!step.at && !step.after) {
      issues.push({ stepIndex: idx, field: 'at/after', message: 'كل خطوة تحتاج توقيت at أو محفز after' });
    }
    if (step.camera) checkAnchor(idx, 'camera.focus', step.camera.focus);
    if (step.spawn) {
      for (const s of step.spawn) {
        spawnedIds.add(s.id);
        checkActor(idx, 'spawn.actor', s.actor);
        checkAnchor(idx, 'spawn.at', s.at);
      }
    }
    if (step.pulse) checkAnchor(idx, 'pulse.at', step.pulse.at);
    if (step.move) {
      if (!spawnedIds.has(step.move.entity)) {
        issues.push({ stepIndex: idx, field: 'move.entity', message: `الوحدة "${step.move.entity}" لم تُنشأ قبل هذا الأمر` });
      }
      checkAnchor(idx, 'move.to', step.move.to);
    }
    if (step.remove && !spawnedIds.has(step.remove.entity)) {
      issues.push({ stepIndex: idx, field: 'remove.entity', message: `الوحدة "${step.remove.entity}" غير موجودة للإزالة` });
    }
    if (step.construct) {
      if (step.construct.id) spawnedIds.add(step.construct.id);
      checkActor(idx, 'construct.actor', step.construct.actor);
      checkAnchor(idx, 'construct.at', step.construct.at);
    }
    if (step.draw_arrow) {
      checkAnchor(idx, 'draw_arrow.from', step.draw_arrow.from);
      checkAnchor(idx, 'draw_arrow.to', step.draw_arrow.to);
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
  });

  return issues;
}

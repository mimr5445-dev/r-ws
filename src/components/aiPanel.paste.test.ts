import test from 'node:test';
import assert from 'node:assert/strict';
import { checkGeneratedScenario } from '../ai/scenarioAssist';

// نفس المنطق المستخدم في زر «تحقق وطبّق» داخل لوحة الهاتف
const maps = {
  world_live: {
    id: 'world_live',
    title: 'العالم',
    kind: 'geopolitical' as const,
    width: 1920,
    height: 1080,
    cellSize: 8,
    cols: 240,
    rows: 135,
    navGrid: new Array(240 * 135).fill(1) as (0 | 1 | 2 | 3)[],
    svgOrUrl: 'data:image/png;base64,',
    anchors: { port_a: { x: 100, y: 100 } },
    zones: {}
  }
};

test('مسح YAML ملصوق من مساعد خارجي: يقبل الصالح ويرفض المخترع', () => {
  const good = 'إليك:\n```yaml\nmeta:\n  map: world_live\ntimeline:\n  - at: "0s"\n    caption: { text: "x" }\n```';
  const ok = checkGeneratedScenario(good, maps, {});
  assert.equal(ok.ok, true, ok.issues.join(' | '));

  const bad = 'meta:\n  map: no_such_map\ntimeline: []';
  const refused = checkGeneratedScenario(bad, maps, {});
  assert.equal(refused.ok, false);
  assert.ok(refused.issues[0].includes('no_such_map'));
});

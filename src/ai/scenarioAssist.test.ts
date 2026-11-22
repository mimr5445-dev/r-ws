import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRepairUserMessage, checkGeneratedScenario, prepareAiPrompt } from './scenarioAssist';
import { DEMO_ACTORS } from '../packs/demoPacks';

// خريطة اصطناعية مطابقة لعقد MapPack (خرائط العالم الحقيقية تُبنى على canvas في المتصفح)
const maps = {
  test_map: {
    id: 'test_map',
    title: 'خريطة اختبار',
    kind: 'geopolitical' as const,
    width: 1000,
    height: 600,
    cellSize: 20,
    cols: 50,
    rows: 30,
    navGrid: new Array(50 * 30).fill(1) as (0 | 1 | 2 | 3)[],
    svgOrUrl: 'data:image/png;base64,',
    anchors: { port_south: { x: 200, y: 400, label: 'ميناء جنوبي' } },
    zones: { strait: { id: 'strait', label: 'مضيق', polygon: [] } }
  }
};
const actors = DEMO_ACTORS;
const validYaml = `meta:
  title: حصار بحري
  map: test_map
timeline:
  - at: "0s"
    caption: { text: "بداية الحصار" }
  - at: "1s"
    spawn:
      - id: ship_a
        actor: destroyer_ship
        at: port_south
        faction: blue
`;

test('prepareAiPrompt يضمّن الخريطة المفضلة والموضوع ويطلب YAML فقط', () => {
  const { system, user } = prepareAiPrompt(maps, actors, 'حصار بحري', 'test_map');
  assert.ok(system.includes('YAML'));
  assert.ok(user.includes('حصار بحري'));
  assert.ok(user.includes('test_map'));
  assert.ok(user.includes('CATALOG.md'));
});

test('checkGeneratedScenario يقبل سيناريو صالحًا ويزيل أسوار الكود', () => {
  const check = checkGeneratedScenario('```yaml\n' + validYaml + '```', maps, actors);
  assert.equal(check.ok, true, check.issues.join(' | '));
  assert.equal(check.scenario?.meta.map, 'test_map');
});

test('checkGeneratedScenario يرفض المراسي أو الكيانات المخترعة', () => {
  const bad = `meta:
  title: خطأ
  map: test_map
timeline:
  - at: "0s"
    spawn:
      - id: ship_a
        actor: invented_actor
        at: invented_anchor
`;
  const check = checkGeneratedScenario(bad, maps, actors);
  assert.equal(check.ok, false);
  assert.ok(check.issues.length > 0);
});

test('checkGeneratedScenario يرصد أخطاء صياغة YAML', () => {
  const check = checkGeneratedScenario('meta: [unclosed', maps, actors);
  assert.equal(check.ok, false);
  assert.ok(check.syntaxError);
});

test('buildRepairUserMessage يضمّن الأخطاء للتصحيح', () => {
  const msg = buildRepairUserMessage('الأصل', ['خطوة 2 · [spawn] كيان غير موجود'], null);
  assert.ok(msg.includes('الأصل'));
  assert.ok(msg.includes('كيان غير موجود'));
  const msg2 = buildRepairUserMessage('الأصل', [], 'unexpected end of stream');
  assert.ok(msg2.includes('unexpected end of stream'));
});

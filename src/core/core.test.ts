import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as yaml from 'js-yaml';
import { findPath, isWalkable } from './pathfinding';
import { validateScenario } from './validator';
import { DT, StudioEngine } from './engine';
import { ScenarioFile } from './types';
import { DEMO_ACTORS, DEMO_MAPS } from '../packs/demoPacks';

test('A* sea pathfinding in geopolitics_strait never crosses land cells', () => {
  const map = DEMO_MAPS.geopolitics_strait;
  const from = map.anchors.port_south;
  const to = map.anchors.port_east;
  const path = findPath(map, from, to, 'sea');

  assert.ok(path.length > 3, 'sea path should have multiple waypoints around peninsula');
  for (const pt of path) {
    const gx = Math.floor(pt.x / map.cellSize);
    const gy = Math.floor(pt.y / map.cellSize);
    const cell = map.navGrid[gy * map.cols + gx];
    assert.equal(isWalkable(cell, 'sea'), true, `waypoint (${pt.x}, ${pt.y}) stepped onto non-sea cell ${cell}`);
  }
});

test('A* land pathfinding in tactical_valley crosses river via the bridge and avoids mountain', () => {
  const map = DEMO_MAPS.tactical_valley;
  const from = map.anchors.base_blue;
  const to = map.anchors.hill_east;
  const path = findPath(map, from, to, 'land');

  assert.ok(path.length > 2, 'land path should cross via bridge');
  let crossedBridge = false;
  for (const pt of path) {
    const gx = Math.floor(pt.x / map.cellSize);
    const gy = Math.floor(pt.y / map.cellSize);
    const cell = map.navGrid[gy * map.cols + gx];
    assert.equal(cell, 0, `land unit stepped on invalid cell ${cell} at (${pt.x}, ${pt.y})`);
    if (pt.x >= 540 && pt.x <= 640 && pt.y >= 350 && pt.y <= 430) {
      crossedBridge = true;
    }
  }
  assert.equal(crossedBridge, true, 'land unit must cross the river through the bridge');
});

test('Scenario validator catches typos with fuzzy hints and accepts preset scenarios', () => {
  const straitRaw = fs.readFileSync('src/scenarios/strait_crisis.scenario.yaml', 'utf8');
  const straitParsed = yaml.load(straitRaw) as ScenarioFile;
  assert.deepEqual(validateScenario(straitParsed, DEMO_MAPS[straitParsed.meta.map], DEMO_ACTORS), []);

  const valleyRaw = fs.readFileSync('src/scenarios/valley_advance.scenario.yaml', 'utf8');
  const valleyParsed = yaml.load(valleyRaw) as ScenarioFile;
  assert.deepEqual(validateScenario(valleyParsed, DEMO_MAPS[valleyParsed.meta.map], DEMO_ACTORS), []);

  const broken: ScenarioFile = {
    meta: { title: 'broken', map: 'geopolitics_strait' },
    timeline: [
      {
        at: '0s',
        spawn: [{ id: 'ship1', actor: 'naval_corvette', at: 'port_sout' }]
      },
      {
        at: '1s',
        move: { entity: 'missing_ship', to: 'strait_gate' }
      }
    ]
  };
  const issues = validateScenario(broken, DEMO_MAPS.geopolitics_strait, DEMO_ACTORS);
  assert.equal(issues.length, 2);
  assert.ok(issues[0].message.includes('port_south'), 'should suggest closest anchor port_south');
  assert.equal(issues[1].field, 'move.entity');
});

test('StudioEngine deterministic 30 TPS simulation executes arrival triggers and construction', () => {
  const straitRaw = fs.readFileSync('src/scenarios/strait_crisis.scenario.yaml', 'utf8');
  const straitParsed = yaml.load(straitRaw) as ScenarioFile;
  const engine = new StudioEngine(DEMO_MAPS.geopolitics_strait, DEMO_ACTORS, straitParsed);
  const sounds: string[] = [];
  engine.onSound((s) => sounds.push(s));

  // At t=0, entities should be spawned
  assert.ok(engine.entities.has('patrol_1'));
  assert.ok(engine.entities.has('envoy_1'));

  // Step 15 seconds (450 ticks) so patrol_1 arrives at strait_gate and radar_1 completes construction
  for (let i = 0; i < 450; i++) {
    engine.step();
  }

  const radar = engine.entities.get('radar_1');
  assert.ok(radar, 'after: patrol_1.arrived should have triggered radar_1 construction');
  assert.equal(radar.buildProgress, 1, 'radar_1 should finish construction');
  assert.ok(sounds.includes('alert_ping'), 'should have emitted alert_ping');
  assert.ok(sounds.includes('build_complete'), 'should have emitted build_complete');
  const zone = engine.zones.get('corridor_south');
  assert.ok(zone && zone.targetOpacity > 0, 'corridor_south zone should be highlighted');
});

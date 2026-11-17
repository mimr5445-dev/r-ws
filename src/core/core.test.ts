import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as yaml from 'js-yaml';
import { findPath, isWalkable } from './pathfinding';
import { validateScenario } from './validator';
import { StudioEngine } from './engine';
import { buildAiScenarioPrompt, generateCatalogMarkdown } from './catalog';
import { MapPack, ScenarioFile } from './types';
import { DEMO_ACTORS, DEMO_MAPS } from '../packs/demoPacks';
import { PackRegistry } from '../packs/packRegistry';

test('A* sea pathfinding in geopolitics_strait never crosses land cells', () => {
  const map = DEMO_MAPS.geopolitics_strait;
  const from = map.anchors.port_south;
  const to = map.anchors.port_east;
  const path = findPath(map, from, to, 'sea');

  assert.ok(path.length >= 2, 'smoothed sea path should bend cleanly around peninsula');
  let prev = from;
  for (const pt of path) {
    for (let s = 0; s <= 10; s++) {
      const x = prev.x + ((pt.x - prev.x) * s) / 10;
      const y = prev.y + ((pt.y - prev.y) * s) / 10;
      const gx = Math.floor(x / map.cellSize);
      const gy = Math.floor(y / map.cellSize);
      const cell = map.navGrid[gy * map.cols + gx];
      assert.equal(isWalkable(cell, 'sea'), true, `segment pt (${x}, ${y}) stepped onto non-sea cell ${cell}`);
    }
    prev = pt;
  }
});

test('A* land pathfinding in tactical_valley crosses river via the bridge and avoids mountain', () => {
  const map = DEMO_MAPS.tactical_valley;
  const from = map.anchors.base_blue;
  const to = map.anchors.hill_east;
  const path = findPath(map, from, to, 'land');

  assert.ok(path.length >= 2, 'smoothed land path should bend through the bridge');
  let crossedBridge = false;
  let prev = from;
  for (const pt of path) {
    for (let s = 0; s <= 12; s++) {
      const x = prev.x + ((pt.x - prev.x) * s) / 12;
      const y = prev.y + ((pt.y - prev.y) * s) / 12;
      const gx = Math.floor(x / map.cellSize);
      const gy = Math.floor(y / map.cellSize);
      const cell = map.navGrid[gy * map.cols + gx];
      assert.equal(cell, 0, `land unit stepped on invalid cell ${cell} at (${x}, ${y})`);
      if (x >= 540 && x <= 640 && y >= 350 && y <= 430) {
        crossedBridge = true;
      }
    }
    prev = pt;
  }
  assert.equal(crossedBridge, true, 'land unit must cross the river through the bridge');
});

test('Scenario validator catches typos and validates v0.2 callout, pulse, and remove', () => {
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
        spawn: [{ id: 'ship1', actor: 'naval_corvette', at: 'port_sout' }],
        pulse: { at: 'strait_gat' }
      },
      {
        at: '1s',
        move: { entity: 'missing_ship', to: 'strait_gate' },
        callout: { id: 'c1', target: 'unknown_target', text: 'bad' },
        remove: { entity: 'ghost_unit' }
      }
    ]
  };
  const issues = validateScenario(broken, DEMO_MAPS.geopolitics_strait, DEMO_ACTORS);
  assert.equal(issues.length, 5);
  assert.ok(issues[0].message.includes('port_south'), 'should suggest closest anchor port_south');
  assert.ok(issues[1].message.includes('strait_gate'), 'should suggest closest anchor for pulse.at');
  assert.equal(issues[2].field, 'move.entity');
  assert.equal(issues[3].field, 'remove.entity');
  assert.equal(issues[4].field, 'callout.target');
});

test('StudioEngine deterministic seekToTick, callouts, pulses, and remove work accurately', () => {
  const scenario: ScenarioFile = {
    meta: { title: 'v0.2 test', map: 'geopolitics_strait' },
    timeline: [
      {
        at: '0s',
        spawn: [{ id: 'patrol_1', actor: 'naval_corvette', at: 'port_south', faction: 'blue' }],
        callout: { id: 'c_temp', target: 'patrol_1', text: 'مهمة', duration: '2s' }
      },
      {
        at: '1s',
        pulse: { at: 'strait_gate', color: '#ef4444', radius: 90 }
      },
      {
        at: '4s',
        remove: { entity: 'patrol_1' }
      }
    ]
  };

  const engine = new StudioEngine(DEMO_MAPS.geopolitics_strait, DEMO_ACTORS, scenario);
  const sounds: string[] = [];
  engine.onSound((s) => sounds.push(s));

  // Scrub forward to 1.2s (tick 36) silently
  engine.seekToTick(36);
  assert.equal(engine.tick, 36);
  assert.equal(sounds.length, 0, 'seekToTick must be silent');
  assert.ok(engine.entities.has('patrol_1'));
  assert.ok(engine.callouts.has('c_temp'));
  assert.equal(engine.pulses.length, 1, 'pulse should be active at 1.2s');

  // Scrub forward to 4.5s (tick 135) -> callout expired, patrol_1 removed
  engine.seekToTick(135);
  assert.equal(engine.callouts.has('c_temp'), false, 'timed callout should expire after 2s');
  assert.equal(engine.entities.has('patrol_1'), false, 'patrol_1 should be removed at 4s');

  // Scrub backward to 0.5s (tick 15) -> patrol_1 and c_temp restored deterministically
  engine.seekToTick(15);
  assert.equal(engine.tick, 15);
  assert.ok(engine.entities.has('patrol_1'));
  assert.ok(engine.callouts.has('c_temp'));
});

test('PackRegistry and Catalog/AI Prompt Generator include custom maps and inherited actors', async () => {
  const reg = new PackRegistry(false);
  await reg.saveCustomActor({
    id: 'cargo_truck',
    label: 'شاحنة إمداد',
    extends: '_vehicle',
    svg: '<svg viewBox="0 0 64 64"><rect width="64" height="64"/></svg>'
  });
  const truck = reg.actors.cargo_truck;
  assert.ok(truck);
  assert.equal(truck.domain, 'land');
  assert.equal(truck.kind, 'vehicle');
  assert.equal(truck.speed, 95);

  const bundle = reg.exportCurrentBundle();
  assert.ok((bundle.maps?.length ?? 0) >= 2);
  assert.ok((bundle.actors?.length ?? 0) >= 7);

  const md = generateCatalogMarkdown(reg.maps, reg.actors);
  assert.ok(md.includes('geopolitics_strait'));
  assert.ok(md.includes('cargo_truck'));

  const prompt = buildAiScenarioPrompt(reg.maps, reg.actors, 'حصار بحري');
  assert.ok(prompt.includes('حصار بحري'));
  assert.ok(prompt.includes('callout'));
  assert.ok(prompt.includes('pulse'));
});

test('MinHeap A* blocks land units across sea and emits onMoveBlocked while supporting canal/bridge cell 3', () => {
  // 10x5 grid: left continent (cols 0..2), ocean (cols 3..6), right continent (cols 7..9)
  const cols = 10;
  const rows = 5;
  const cellSize = 20;
  const navGrid: Array<0 | 1 | 2 | 3> = new Array(cols * rows).fill(1);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x <= 2; x++) navGrid[y * cols + x] = 0;
    for (let x = 7; x < cols; x++) navGrid[y * cols + x] = 0;
  }

  const splitMap = {
    id: 'split_continents',
    title: 'Split Continents',
    kind: 'geopolitical' as const,
    width: cols * cellSize,
    height: rows * cellSize,
    cellSize,
    cols,
    rows,
    navGrid,
    svgOrUrl: '',
    anchors: {
      west_land: { x: 20, y: 50 },
      east_land: { x: 170, y: 50 },
      mid_ocean: { x: 100, y: 50 }
    },
    zones: {}
  };

  // Tank cannot cross mid_ocean or reach east_land across sea
  assert.deepEqual(findPath(splitMap, splitMap.anchors.west_land, splitMap.anchors.east_land, 'land'), []);
  assert.deepEqual(findPath(splitMap, splitMap.anchors.west_land, splitMap.anchors.mid_ocean, 'land'), []);

  // Engine triggers onMoveBlocked when tank receives unreachable ocean/island order
  const engine = new StudioEngine(splitMap, DEMO_ACTORS, {
    meta: { title: 'blocked test', map: 'split_continents' },
    timeline: [{ at: '0s', spawn: [{ id: 't1', actor: 'heavy_tank', at: 'west_land' }] }]
  });
  let blockedCount = 0;
  engine.onMoveBlocked(() => {
    blockedCount++;
  });
  engine.dispatchOrder({ type: 'move', entityId: 't1', to: splitMap.anchors.east_land });
  engine.flushOrders();
  assert.equal(blockedCount, 1, 'engine should emit onMoveBlocked for disconnected land destination');

  // Verify NavCell = 3 allows both land and sea traversal when connected
  navGrid[2 * cols + 3] = 3;
  navGrid[2 * cols + 4] = 3;
  navGrid[2 * cols + 5] = 3;
  navGrid[2 * cols + 6] = 3;
  const canalLandPath = findPath(splitMap, splitMap.anchors.west_land, splitMap.anchors.east_land, 'land');
  assert.ok(canalLandPath.length > 0, 'land unit should cross via canal/bridge cells (3)');
  assert.equal(isWalkable(3, 'sea'), true, 'sea unit should also traverse canal cell (3)');
});

test('rewindGeoJsonForD3 converts RFC 7946 CCW province polygons to D3 spherical CW winding', async () => {
  const { geoArea, geoCentroid } = await import('d3-geo');
  const { rewindGeoJsonForD3 } = await import('../maps/worldGeoEngine');
  const ccwFc: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { shapeName: 'Riyadh' },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [44, 23],
              [46, 23],
              [46, 25],
              [44, 25],
              [44, 23]
            ]
          ]
        }
      }
    ]
  };
  assert.ok(geoArea(ccwFc) > 2 * Math.PI, 'raw RFC 7946 CCW square appears inverted to d3-geo');
  const rewound = rewindGeoJsonForD3(ccwFc);
  assert.ok(geoArea(rewound) < 0.01, 'rewound square has true small spherical area');
  const [lon, lat] = geoCentroid(rewound);
  assert.ok(Math.abs(lon - 45) < 0.5 && Math.abs(lat - 24) < 0.5, `centroid (${lon}, ${lat}) should stay inside box`);
});

test('ActionRecorder generates valid YAML with free PointRef coordinates that replays in StudioEngine', async () => {
  const { ActionRecorder } = await import('./actionRecorder');
  const map = DEMO_MAPS.tactical_valley;
  const recorder = new ActionRecorder();
  recorder.start(map.id, { x: 600, y: 400, zoom: 1.0 });
  recorder.recordSpawn('sb_1', 'heavy_tank', { x: 180, y: 400 }, 'blue');
  recorder.recordMove('sb_1', { x: 450, y: 230 });
  recorder.recordConstruct('sb_2', 'radar_outpost', { x: 240, y: 300 }, 'blue', 1.8);
  recorder.recordZone('east_sector', '#ef4444', 0.38);
  recorder.recordArrow('arr_1', { x: 180, y: 400 }, { x: 590, y: 390 });
  recorder.recordPulse({ x: 590, y: 390 });
  recorder.recordCaption('تجربة مسجلة');
  recorder.stop();

  const generatedYaml = recorder.toYaml('عرض تجريبي مسجل');
  const parsed = yaml.load(generatedYaml) as ScenarioFile;
  assert.deepEqual(validateScenario(parsed, map, DEMO_ACTORS), [], 'recorded YAML should pass validation cleanly');

  const replay = new StudioEngine(map, DEMO_ACTORS, parsed);
  replay.seekToTick(90);
  assert.ok(replay.entities.has('sb_1'), 'recorded spawned tank exists during replay');
  assert.ok(replay.entities.has('sb_2'), 'recorded constructed building exists during replay');
  assert.ok(replay.arrows.has('arr_1'), 'recorded arrow exists during replay');
  assert.equal(replay.caption, 'تجربة مسجلة');
});

test('rehydrateMapPack restores hitTest polygon picking after IndexedDB serialization', async () => {
  const { rehydrateMapPack } = await import('../storage/studioDb');
  const baseMap = {
    ...DEMO_MAPS.tactical_valley,
    hitTest: undefined,
    regions: {
      zone_a: {
        id: 'zone_a',
        name: 'Zone A',
        center: { x: 150, y: 150 },
        bounds: { minX: 100, minY: 100, maxX: 200, maxY: 200 },
        polygons: [
          [
            { x: 100, y: 100 },
            { x: 200, y: 100 },
            { x: 200, y: 200 },
            { x: 100, y: 200 }
          ]
        ]
      }
    }
  };
  const rehydrated = rehydrateMapPack(baseMap);
  assert.equal(typeof rehydrated.hitTest, 'function');
  assert.equal(rehydrated.hitTest?.({ x: 150, y: 150 }), 'zone_a');
  assert.equal(rehydrated.hitTest?.({ x: 50, y: 50 }), null);
});

test('validateScenario guards malformed timelines, invalid sound/faction/after, and engine honors duration_hint', () => {
  const badTimeline = { meta: { title: 'bad', map: 'tactical_valley' }, timeline: 'oops' } as unknown as ScenarioFile;
  const tlIssues = validateScenario(badTimeline, DEMO_MAPS.tactical_valley, DEMO_ACTORS);
  assert.equal(tlIssues[0]?.field, 'timeline');

  const nullStep = {
    meta: { title: 'bad2', map: 'tactical_valley' },
    timeline: [
      null,
      { at: '0s', sound: 'bad_sfx', spawn: [{ id: 'u1', actor: 'heavy_tank', at: 'base_blue', faction: 'green' }] },
      { after: 'ghost.arrived', caption: { text: 'bad' } }
    ]
  } as unknown as ScenarioFile;
  const issues = validateScenario(nullStep, DEMO_MAPS.tactical_valley, DEMO_ACTORS);
  assert.ok(issues.some((i) => i.field === 'step'));
  assert.ok(issues.some((i) => i.field === 'sound'));
  assert.ok(issues.some((i) => i.field === 'spawn.faction'));
  assert.ok(issues.some((i) => i.field === 'after'));

  const hinted = new StudioEngine(DEMO_MAPS.tactical_valley, DEMO_ACTORS, {
    meta: { title: 'hinted', map: 'tactical_valley', duration_hint: '42s' },
    timeline: [
      {
        at: '0s',
        spawn: [{ id: 'u1', actor: 'heavy_tank', at: 'base_blue', faction: 'blue' }],
        callout: { id: 'c_perm', target: 'u1', text: 'باقية حتى الحذف' }
      },
      { at: '1s', remove: { entity: 'u1' } }
    ]
  });
  assert.equal(hinted.estimateDurationSec(), 42);
  hinted.seekToTick(40);
  assert.equal(hinted.callouts.has('c_perm'), false, 'permanent entity callout should be removed with its target entity');
});

test('Upgrade 6: air_sea_strike validates, smooths paths, keeps person upright, flies aircraft, and detonates strikes', () => {
  const airSeaRaw = fs.readFileSync('src/scenarios/air_sea_strike.scenario.yaml', 'utf8');
  const airSeaParsed = yaml.load(airSeaRaw) as ScenarioFile;
  assert.deepEqual(validateScenario(airSeaParsed, DEMO_MAPS[airSeaParsed.meta.map], DEMO_ACTORS), []);

  // Path smoothing simplifies clear diagonal routes into very few waypoints
  const valley = DEMO_MAPS.tactical_valley;
  const smoothLand = findPath(valley, { x: 100, y: 120 }, { x: 460, y: 360 }, 'land');
  assert.ok(smoothLand.length <= 4, `expected smoothed land path <= 4 pts, got ${smoothLand.length}`);

  // Person stays upright (angle === 0), aircraft takes off (altitude > 0) and lands back (altitude === 0)
  const sim = new StudioEngine(DEMO_MAPS.geopolitics_strait, DEMO_ACTORS, {
    meta: { title: 'physics & strike test', map: 'geopolitics_strait' },
    timeline: [
      {
        at: '0s',
        spawn: [
          { id: 'dip', actor: 'diplomat_person', at: { x: 120, y: 160 }, faction: 'blue' },
          { id: 'jet', actor: 'fighter_jet', at: 'capital_north', faction: 'blue' },
          { id: 'oil', actor: 'oil_facility', at: { x: 560, y: 200 }, faction: 'red' }
        ]
      },
      {
        at: '0.2s',
        move: { entity: 'dip', to: { x: 300, y: 260 } },
        strike: { attacker: 'jet', mode: 'airstrike', to: { x: 560, y: 200 }, radius: 75 }
      }
    ]
  });

  const startAnchor = DEMO_MAPS.geopolitics_strait.anchors.capital_north;
  const heard: string[] = [];
  sim.onSound((s) => heard.push(s));

  for (let i = 0; i < 45; i++) sim.step();
  const dipMid = sim.entities.get('dip');
  const jetMid = sim.entities.get('jet');
  assert.equal(dipMid?.angle, 0, 'person angle must remain 0 so figure never flips upside-down');
  assert.ok((jetMid?.altitude ?? 0) > 0.35, 'fighter jet must climb in altitude during airstrike sortie');
  assert.ok(heard.includes('jet_takeoff'), 'airstrike should emit jet_takeoff');

  for (let i = 0; i < 240; i++) sim.step();
  assert.equal(sim.entities.has('oil'), false, 'opposing oil_facility should be destroyed by airstrike');
  assert.ok(sim.craters.length >= 1, 'explosion should leave temporary crater decal');
  assert.ok(heard.includes('explosion'), 'impact should emit explosion sound');
  const jetEnd = sim.entities.get('jet');
  assert.ok(jetEnd, 'fighter jet must remain alive');
  const distHome = Math.hypot(jetEnd.x - startAnchor.x, jetEnd.y - startAnchor.y);
  assert.ok(distHome < 18, `fighter jet must return to takeoff base, got dist=${distHome.toFixed(1)}`);
  assert.ok((jetEnd.altitude ?? 1) < 0.05, 'fighter jet should descend and land after returning to base');

  // Ballistic missile strike test
  sim.dispatchOrder({
    type: 'strike',
    mode: 'missile',
    from: { x: 180, y: 200 },
    to: { x: 700, y: 200 },
    radius: 80,
    faction: 'blue'
  });
  sim.flushOrders();
  assert.ok(heard.includes('missile_launch'), 'missile strike should emit missile_launch');
  assert.equal(sim.projectiles.length, 1);
  for (let i = 0; i < 90; i++) sim.step();
  assert.ok(sim.craters.length >= 1, 'missile detonation should leave crater decal');

  // Craters must fade out and disappear automatically after ~7.5s
  for (let i = 0; i < 250; i++) sim.step();
  assert.equal(sim.craters.length, 0, 'temporary blast craters must expire and vanish completely');
});

test('Ships never climb onto land cells during curved turns and entities support individual scaleMul', async () => {
  const map = DEMO_MAPS.geopolitics_strait;
  const sim = new StudioEngine(map, DEMO_ACTORS, {
    meta: { title: 'sea safety & individual resize', map: 'geopolitics_strait' },
    timeline: [
      {
        at: '0s',
        spawn: [
          { id: 'carrier', actor: 'aircraft_carrier', at: 'port_south', faction: 'blue', scale: 1.65 },
          { id: 'tank', actor: 'heavy_tank', at: 'capital_north', faction: 'blue' }
        ]
      },
      {
        at: '0.1s',
        move: { entity: 'carrier', to: 'port_east' }
      },
      {
        at: '0.5s',
        resize: { entity: 'tank', scale: 0.55 }
      }
    ]
  });

  // Assert carrier never steps onto a land cell at any tick around the peninsula turn
  for (let i = 0; i < 450; i++) {
    sim.step();
    const ship = sim.entities.get('carrier');
    assert.ok(ship);
    const gx = Math.floor(ship.x / map.cellSize);
    const gy = Math.floor(ship.y / map.cellSize);
    const cell = map.navGrid[gy * map.cols + gx];
    assert.equal(isWalkable(cell, 'sea'), true, `carrier crossed land cell (${gx},${gy})=${cell} at tick ${sim.tick}`);
  }

  // Assert individual scales remain independent
  assert.equal(sim.entities.get('carrier')?.scaleMul, 1.65);
  assert.equal(sim.entities.get('tank')?.scaleMul, 0.55);

  // ActionRecorder round-trip with spawn.scale and resize
  const { ActionRecorder } = await import('./actionRecorder');
  const rec = new ActionRecorder();
  rec.start(map.id, { x: 600, y: 400, zoom: 1 });
  rec.recordSpawn('c1', 'aircraft_carrier', map.anchors.port_south, 'blue', 1.4);
  rec.recordResize('c1', 0.75);
  rec.stop();
  const parsed = yaml.load(rec.toYaml('resize rec')) as ScenarioFile;
  assert.deepEqual(validateScenario(parsed, map, DEMO_ACTORS), []);
  const replay = new StudioEngine(map, DEMO_ACTORS, parsed);
  replay.seekToTick(30);
  assert.equal(replay.entities.get('c1')?.scaleMul, 0.75);
});

test('P0 Hardening: all built-in .scenario.yaml files validate cleanly', () => {
  const worldLiveStub = {
    ...DEMO_MAPS.geopolitics_strait,
    id: 'world_live',
    width: 2000,
    height: 1000,
    anchors: {
      red_sea: { x: 1210, y: 420 },
      arabian_sea: { x: 1320, y: 460 },
      riyadh: { x: 1255, y: 395 },
      mediterranean: { x: 1120, y: 315 },
      cairo: { x: 1175, y: 365 }
    }
  };
  const mapsLookup: Record<string, MapPack> = { ...DEMO_MAPS, world_live: worldLiveStub };
  for (const fname of ['strait_crisis', 'valley_advance', 'air_sea_strike', 'world_demo']) {
    const raw = fs.readFileSync(`src/scenarios/${fname}.scenario.yaml`, 'utf8');
    const parsed = yaml.load(raw) as ScenarioFile;
    assert.deepEqual(
      validateScenario(parsed, mapsLookup[parsed.meta.map], DEMO_ACTORS),
      [],
      `${fname}.scenario.yaml must have zero validation issues`
    );
  }
});

test('P0 Hardening: duplicate/empty entity IDs are rejected in validator and refused by StudioEngine', () => {
  const dupScenario: ScenarioFile = {
    meta: { title: 'dup ids', map: 'geopolitics_strait' },
    timeline: [
      {
        at: '0s',
        spawn: [
          { id: 'u1', actor: 'naval_corvette', at: 'port_south', faction: 'blue' },
          { id: 'u1', actor: 'heavy_tank', at: 'capital_north', faction: 'red' },
          { id: '   ', actor: 'heavy_tank', at: 'capital_north', faction: 'blue' }
        ]
      },
      {
        at: '1s',
        construct: { id: 'u1', actor: 'radar_outpost', at: 'capital_north', faction: 'red' }
      }
    ]
  };
  const issues = validateScenario(dupScenario, DEMO_MAPS.geopolitics_strait, DEMO_ACTORS);
  assert.ok(issues.some((i) => i.field === 'spawn.id' && i.message.includes('مكرر')));
  assert.ok(issues.some((i) => i.field === 'spawn.id' && i.message.includes('مطلوب')));
  assert.ok(issues.some((i) => i.field === 'construct.id' && i.message.includes('مكرر')));

  const engine = new StudioEngine(DEMO_MAPS.geopolitics_strait, DEMO_ACTORS, {
    meta: { title: 'engine no overwrite', map: 'geopolitics_strait' },
    timeline: [{ at: '0s', spawn: [{ id: 'u1', actor: 'naval_corvette', at: 'port_south', faction: 'blue' }] }]
  });
  engine.dispatchOrder({
    type: 'spawn',
    id: 'u1',
    actorId: 'heavy_tank',
    at: DEMO_MAPS.geopolitics_strait.anchors.capital_north,
    faction: 'red'
  });
  engine.dispatchOrder({
    type: 'construct',
    id: 'u1',
    actorId: 'radar_outpost',
    at: DEMO_MAPS.geopolitics_strait.anchors.capital_north,
    faction: 'red',
    durationSec: 2
  });
  engine.flushOrders();
  assert.equal(engine.entities.get('u1')?.actorId, 'naval_corvette');
  assert.equal(engine.entities.get('u1')?.faction, 'blue');
});

test('P0 Hardening: post-remove and out-of-order entity lifecycle rules work accurately', () => {
  // Rejects provably post-removal move/resize/remove/callout and pre-creation move
  const badLifecycle: ScenarioFile = {
    meta: { title: 'bad lifecycle', map: 'geopolitics_strait' },
    timeline: [
      { at: '0.5s', move: { entity: 's1', to: 'strait_gate' } },
      { at: '1s', spawn: [{ id: 's1', actor: 'naval_corvette', at: 'port_south' }] },
      { at: '2s', remove: { entity: 's1' } },
      { at: '3s', resize: { entity: 's1', scale: 1.5 }, callout: { id: 'c1', target: 's1', text: 'ghost' }, remove: { entity: 's1' } }
    ]
  };
  const badIssues = validateScenario(badLifecycle, DEMO_MAPS.geopolitics_strait, DEMO_ACTORS);
  assert.ok(badIssues.some((i) => i.stepIndex === 0 && i.field === 'move.entity'));
  assert.ok(badIssues.some((i) => i.stepIndex === 3 && i.field === 'resize.entity'));
  assert.ok(badIssues.some((i) => i.stepIndex === 3 && i.field === 'callout.target'));
  assert.ok(badIssues.some((i) => i.stepIndex === 3 && i.field === 'remove.entity'));

  // Same `after` trigger removing then using in later step index must be rejected
  const sameAfterRemoval: ScenarioFile = {
    meta: { title: 'same trigger remove', map: 'geopolitics_strait' },
    timeline: [
      { at: '0s', spawn: [{ id: 'scout', actor: 'naval_corvette', at: 'port_south' }, { id: 'b1', actor: 'radar_outpost', at: 'capital_north' }] },
      { at: '0.2s', move: { entity: 'scout', to: 'strait_gate' } },
      { after: 'scout.arrived', remove: { entity: 'b1' } },
      { after: 'scout.arrived', resize: { entity: 'b1', scale: 1.2 } }
    ]
  };
  const sameTrigIssues = validateScenario(sameAfterRemoval, DEMO_MAPS.geopolitics_strait, DEMO_ACTORS);
  assert.ok(sameTrigIssues.some((i) => i.stepIndex === 3 && i.field === 'resize.entity'));

  // Accepts valid out-of-order `at` timeline AND valid cross-branch `after` referencing unit removed at later `at`
  const validOutOfOrderAndConditional: ScenarioFile = {
    meta: { title: 'valid timeline', map: 'geopolitics_strait' },
    timeline: [
      { at: '0s', spawn: [{ id: 's1', actor: 'naval_corvette', at: 'port_south' }, { id: 's2', actor: 'naval_corvette', at: 'port_south' }] },
      { at: '0.5s', move: { entity: 's1', to: 'strait_gate' } },
      { at: '12s', remove: { entity: 's2' } },
      { at: '4s', resize: { entity: 's2', scale: 1.3 } },
      { after: 's1.arrived', move: { entity: 's2', to: 'port_east' } }
    ]
  };
  assert.deepEqual(validateScenario(validOutOfOrderAndConditional, DEMO_MAPS.geopolitics_strait, DEMO_ACTORS), []);
});

test('P0 Hardening: strict timing, at+after conflict, map bounds, and numeric limits are enforced', async () => {
  const { parseStrictSec } = await import('./engine');
  assert.equal(parseStrictSec('0s'), 0);
  assert.equal(parseStrictSec('2.5s'), 2.5);
  assert.equal(parseStrictSec(1.5), 1.5);
  assert.equal(parseStrictSec('-5s'), null);
  assert.equal(parseStrictSec('12abc'), null);
  assert.equal(parseStrictSec('5ms'), null);
  assert.equal(parseStrictSec(''), null);
  assert.equal(parseStrictSec(Infinity), null);
  assert.equal(parseStrictSec(NaN), null);

  const badInputs: ScenarioFile = {
    meta: { title: 'bad params', map: 'geopolitics_strait', duration_hint: '0s' },
    timeline: [
      { at: '-2s', caption: { text: 'neg' } },
      { at: '12abc', caption: { text: 'malformed' } },
      { at: '1s', after: 'u1.arrived', caption: { text: 'conflict' } },
      {
        at: '0s',
        spawn: [{ id: 'u1', actor: 'naval_corvette', at: { x: 9999, y: -10 } }],
        camera: { focus: 'port_south', zoom: 99, duration: '-1s' },
        zone: { id: 'strait_choke', color: '#ef4444', opacity: 2.5, duration: '0s' },
        pulse: { at: 'port_south', radius: 0 },
        strike: { mode: 'missile', to: 'port_south', radius: -20 }
      }
    ]
  };
  const issues = validateScenario(badInputs, DEMO_MAPS.geopolitics_strait, DEMO_ACTORS);
  for (const expectedField of [
    'meta.duration_hint',
    'at',
    'at/after',
    'spawn.at',
    'camera.zoom',
    'camera.duration',
    'zone.opacity',
    'zone.duration',
    'pulse.radius',
    'strike.radius'
  ]) {
    assert.ok(issues.some((i) => i.field === expectedField), `expected validation issue for ${expectedField}`);
  }

  // Malformed `at` must NOT execute at tick 0 in StudioEngine
  const engine = new StudioEngine(DEMO_MAPS.geopolitics_strait, DEMO_ACTORS, {
    meta: { title: 'malformed at', map: 'geopolitics_strait' },
    timeline: [{ at: 'abc', caption: { text: 'should never run' } }]
  });
  engine.step();
  assert.equal(engine.caption, '');
});





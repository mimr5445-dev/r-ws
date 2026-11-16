import test from 'node:test';
import assert from 'node:assert/strict';
import { isSafeAssetUrl, validatePackBundle } from './packSchema';

const goodMap = {
  id: 'm1', title: 'Map', kind: 'tactical', width: 40, height: 40, cellSize: 10,
  cols: 4, rows: 4, navGrid: new Array(16).fill(0), svgOrUrl: '<svg viewBox="0 0 40 40"></svg>',
  anchors: { a: { x: 1, y: 2 } }, zones: {},
};
const goodActor = { id: 'tank', label: 'Tank', svg: '<svg></svg>', kind: 'vehicle', domain: 'land', speed: 3 };

test('a well-formed bundle passes validation', () => {
  assert.deepEqual(validatePackBundle({ maps: [goodMap], actors: [goodActor] }), []);
});

test('external URLs are rejected, local and data/blob URLs are accepted', () => {
  assert.equal(isSafeAssetUrl('https://evil.example/x.svg'), false);
  assert.equal(isSafeAssetUrl('//evil.example/x.svg'), false);
  assert.equal(isSafeAssetUrl('javascript:alert(1)'), false);
  assert.equal(isSafeAssetUrl('blob:https://app/123'), true);
  assert.equal(isSafeAssetUrl('data:image/svg+xml;base64,AAA'), true);
  assert.equal(isSafeAssetUrl('/assets/map.svg'), true);
  assert.equal(isSafeAssetUrl('<svg></svg>'), true);
});

test('navGrid size must match cols × rows', () => {
  const errs = validatePackBundle({ maps: [{ ...goodMap, navGrid: [0, 0] }] });
  assert.ok(errs.some((e) => e.includes('navGrid')));
});

test('a bundle with a bad actor is rejected with a located message', () => {
  const errs = validatePackBundle({ actors: [{ ...goodActor, speed: -1 }] });
  assert.ok(errs.some((e) => e.startsWith('actors[0]') && e.includes('speed')));
});

test('non-object input is rejected', () => {
  assert.notEqual(validatePackBundle(null).length, 0);
  assert.notEqual(validatePackBundle('text').length, 0);
});

test('navGrid cell values, zones polygons, and unitScaleMultiplier are validated', () => {
  const badGrid = new Array(16).fill(0);
  badGrid[3] = 99;
  const errs = validatePackBundle({
    maps: [
      {
        ...goodMap,
        navGrid: badGrid,
        unitScaleMultiplier: -0.5,
        zones: { z1: { id: 'z1', label: 'bad', polygon: [{ x: 0, y: 0 }] } }
      }
    ]
  });
  assert.ok(errs.some((e) => e.includes('navGrid')));
  assert.ok(errs.some((e) => e.includes('unitScaleMultiplier')));
  assert.ok(errs.some((e) => e.includes('z1')));
});

test('air actor kind is accepted by packSchema', () => {
  const airActor = {
    id: 'recon_drone',
    label: 'طائرة استطلاع',
    svg: '<svg viewBox="0 0 64 64"></svg>',
    kind: 'air',
    domain: 'air',
    speed: 190
  };
  assert.deepEqual(validatePackBundle({ actors: [airActor] }), []);
});



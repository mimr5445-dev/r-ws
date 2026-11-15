import { Domain, MapPack, NavCell, Point } from './types';

export function isWalkable(cell: NavCell, domain: Domain): boolean {
  if (domain === 'air') return true;
  if (domain === 'land') return cell === 0;
  if (domain === 'sea') return cell === 1;
  return false;
}

function findNearestWalkable(map: MapPack, gx: number, gy: number, domain: Domain): [number, number] | null {
  const clamp = (v: number, max: number) => Math.max(0, Math.min(max - 1, v));
  const sx = clamp(gx, map.cols);
  const sy = clamp(gy, map.rows);
  if (isWalkable(map.navGrid[sy * map.cols + sx], domain)) return [sx, sy];

  for (let r = 1; r <= 12; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const nx = sx + dx;
        const ny = sy + dy;
        if (nx >= 0 && ny >= 0 && nx < map.cols && ny < map.rows) {
          if (isWalkable(map.navGrid[ny * map.cols + nx], domain)) return [nx, ny];
        }
      }
    }
  }
  return null;
}

export function findPath(map: MapPack, from: Point, to: Point, domain: Domain): Point[] {
  if (domain === 'air') return [{ ...to }];

  const startRaw: [number, number] = [Math.floor(from.x / map.cellSize), Math.floor(from.y / map.cellSize)];
  const endRaw: [number, number] = [Math.floor(to.x / map.cellSize), Math.floor(to.y / map.cellSize)];

  const start = findNearestWalkable(map, startRaw[0], startRaw[1], domain);
  const goal = findNearestWalkable(map, endRaw[0], endRaw[1], domain);
  if (!start || !goal) return [{ ...to }];

  const total = map.cols * map.rows;
  const gScore = new Float32Array(total).fill(Infinity);
  const fScore = new Float32Array(total).fill(Infinity);
  const cameFrom = new Int32Array(total).fill(-1);
  const closed = new Uint8Array(total);
  const inOpen = new Uint8Array(total);
  const open: number[] = [];

  const idx = (x: number, y: number) => y * map.cols + x;
  const sIdx = idx(start[0], start[1]);
  const gIdx = idx(goal[0], goal[1]);

  gScore[sIdx] = 0;
  fScore[sIdx] = Math.hypot(goal[0] - start[0], goal[1] - start[1]);
  open.push(sIdx);
  inOpen[sIdx] = 1;

  const dirs = [
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, 1.414], [-1, 1, 1.414], [1, -1, 1.414], [-1, -1, 1.414]
  ];

  while (open.length > 0) {
    let bestPos = 0;
    for (let i = 1; i < open.length; i++) {
      if (fScore[open[i]] < fScore[open[bestPos]]) bestPos = i;
    }
    const curr = open[bestPos];
    open.splice(bestPos, 1);
    inOpen[curr] = 0;

    if (curr === gIdx) {
      const pts: Point[] = [];
      let c = curr;
      while (c !== -1 && c !== sIdx) {
        const cx = c % map.cols;
        const cy = Math.floor(c / map.cols);
        pts.push({ x: (cx + 0.5) * map.cellSize, y: (cy + 0.5) * map.cellSize });
        c = cameFrom[c];
      }
      pts.reverse();
      const goalWorld = {
        x: (goal[0] + 0.5) * map.cellSize,
        y: (goal[1] + 0.5) * map.cellSize
      };
      // If requested destination itself is walkable, land accurately on exact `to`, otherwise stop at nearest walkable goal center
      const rawGoalWalkable =
        endRaw[0] >= 0 &&
        endRaw[0] < map.cols &&
        endRaw[1] >= 0 &&
        endRaw[1] < map.rows &&
        isWalkable(map.navGrid[idx(endRaw[0], endRaw[1])], domain);
      const finalPt = rawGoalWalkable ? { ...to } : goalWorld;
      if (pts.length > 0) pts[pts.length - 1] = finalPt;
      else pts.push(finalPt);
      return pts;
    }

    closed[curr] = 1;
    const cx = curr % map.cols;
    const cy = Math.floor(curr / map.cols);

    for (const [dx, dy, cost] of dirs) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= map.cols || ny >= map.rows) continue;
      const nIdx = idx(nx, ny);
      if (closed[nIdx]) continue;
      if (!isWalkable(map.navGrid[nIdx], domain)) continue;
      // منع القطع القطري عبر زوايا العوائق
      if (dx !== 0 && dy !== 0) {
        if (!isWalkable(map.navGrid[idx(cx + dx, cy)], domain) || !isWalkable(map.navGrid[idx(cx, cy + dy)], domain)) {
          continue;
        }
      }
      const tentative = gScore[curr] + cost;
      if (tentative < gScore[nIdx]) {
        cameFrom[nIdx] = curr;
        gScore[nIdx] = tentative;
        fScore[nIdx] = tentative + Math.hypot(goal[0] - nx, goal[1] - ny);
        if (!inOpen[nIdx]) {
          open.push(nIdx);
          inOpen[nIdx] = 1;
        }
      }
    }
  }
  return [{ ...to }];
}

import { Domain, MapPack, NavCell, Point } from './types';

export function isWalkable(cell: NavCell, domain: Domain): boolean {
  if (domain === 'air') return true;
  if (domain === 'land') return cell === 0 || cell === 3;
  if (domain === 'sea') return cell === 1 || cell === 3;
  return false;
}

export function findNearestWalkable(
  map: MapPack,
  gx: number,
  gy: number,
  domain: Domain,
  maxRadius: number
): [number, number] | null {
  const clamp = (v: number, max: number) => Math.max(0, Math.min(max - 1, v));
  const sx = clamp(gx, map.cols);
  const sy = clamp(gy, map.rows);
  if (isWalkable(map.navGrid[sy * map.cols + sx], domain)) return [sx, sy];

  for (let r = 1; r <= maxRadius; r++) {
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

export function isPointNearWalkable(map: MapPack, pt: Point, domain: Domain, maxRadius = 2): boolean {
  if (domain === 'air') return true;
  const gx = Math.floor(pt.x / map.cellSize);
  const gy = Math.floor(pt.y / map.cellSize);
  return findNearestWalkable(map, gx, gy, domain, maxRadius) !== null;
}

class MinHeap {
  private data: number[] = [];
  constructor(private score: Float32Array) {}

  get size(): number {
    return this.data.length;
  }

  push(node: number): void {
    this.data.push(node);
    let i = this.data.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.score[this.data[p]] <= this.score[this.data[i]]) break;
      [this.data[p], this.data[i]] = [this.data[i], this.data[p]];
      i = p;
    }
  }

  pop(): number {
    const top = this.data[0];
    const last = this.data.pop()!;
    if (this.data.length > 0) {
      this.data[0] = last;
      let i = 0;
      const n = this.data.length;
      while (true) {
        let smallest = i;
        const l = i * 2 + 1;
        const r = l + 1;
        if (l < n && this.score[this.data[l]] < this.score[this.data[smallest]]) smallest = l;
        if (r < n && this.score[this.data[r]] < this.score[this.data[smallest]]) smallest = r;
        if (smallest === i) break;
        [this.data[i], this.data[smallest]] = [this.data[smallest], this.data[i]];
        i = smallest;
      }
    }
    return top;
  }
}

export function findPath(map: MapPack, from: Point, to: Point, domain: Domain): Point[] {
  if (domain === 'air') return [{ ...to }];

  const startRaw: [number, number] = [Math.floor(from.x / map.cellSize), Math.floor(from.y / map.cellSize)];
  const endRaw: [number, number] = [Math.floor(to.x / map.cellSize), Math.floor(to.y / map.cellSize)];

  const start = findNearestWalkable(map, startRaw[0], startRaw[1], domain, 4);
  // للهدف: نسمح بالتقاط الساحل القريب جدًا فقط (خليتين)، أما وسط البحر للدبابة فيُرفض!
  const goal = findNearestWalkable(map, endRaw[0], endRaw[1], domain, 2);
  if (!start || !goal) return [];

  const total = map.cols * map.rows;
  const gScore = new Float32Array(total).fill(Infinity);
  const fScore = new Float32Array(total).fill(Infinity);
  const cameFrom = new Int32Array(total).fill(-1);
  const closed = new Uint8Array(total);
  const inOpen = new Uint8Array(total);
  const heap = new MinHeap(fScore);

  const idx = (x: number, y: number) => y * map.cols + x;
  const sIdx = idx(start[0], start[1]);
  const gIdx = idx(goal[0], goal[1]);

  gScore[sIdx] = 0;
  fScore[sIdx] = Math.hypot(goal[0] - start[0], goal[1] - start[1]);
  heap.push(sIdx);
  inOpen[sIdx] = 1;

  const dirs = [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
    [1, 1, 1.414],
    [-1, 1, 1.414],
    [1, -1, 1.414],
    [-1, -1, 1.414]
  ];

  while (heap.size > 0) {
    const curr = heap.pop();
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
      const rawGoalValid =
        endRaw[0] >= 0 &&
        endRaw[0] < map.cols &&
        endRaw[1] >= 0 &&
        endRaw[1] < map.rows &&
        isWalkable(map.navGrid[idx(endRaw[0], endRaw[1])], domain);
      const goalWorld = {
        x: (goal[0] + 0.5) * map.cellSize,
        y: (goal[1] + 0.5) * map.cellSize
      };
      if (pts.length > 0) {
        pts[pts.length - 1] = rawGoalValid ? { ...to } : goalWorld;
      } else {
        pts.push(rawGoalValid ? { ...to } : goalWorld);
      }
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
      if (closed[nIdx] || !isWalkable(map.navGrid[nIdx], domain)) continue;
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
          heap.push(nIdx);
          inOpen[nIdx] = 1;
        }
      }
    }
  }

  return []; // لا يوجد مسار متصل (مثلًا بين قارتين عبر البحر)
}

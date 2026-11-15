import { Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { StudioEngine, normalizeAngleDiff } from '../core/engine';
import { EntityState, Faction, MapPack, Point } from '../core/types';

async function loadSvgOrUrlTexture(src: string, fallbackW = 128, fallbackH = 128): Promise<Texture> {
  const trimmed = src.trim();
  const isSvg = trimmed.startsWith('<svg');
  let url = src;
  let w = fallbackW;
  let h = fallbackH;

  if (isSvg) {
    const vbMatch = trimmed.match(/viewBox=["']\s*[\d.-]+\s+[\d.-]+\s+([\d.]+)\s+([\d.]+)\s*["']/i);
    if (vbMatch) {
      w = Math.max(1, Math.round(parseFloat(vbMatch[1])));
      h = Math.max(1, Math.round(parseFloat(vbMatch[2])));
    }
    let normalizedSvg = trimmed;
    if (!/\bwidth=/.test(normalizedSvg.slice(0, 220))) {
      normalizedSvg = normalizedSvg.replace('<svg', `<svg width="${w}" height="${h}"`);
    }
    url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(normalizedSvg)}`;
  }

  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = (err) => reject(err);
    img.src = url;
  });
  if (img.decode) {
    try {
      await img.decode();
    } catch {
      // Image already decoded on load
    }
  }

  const outW = isSvg ? (w < 256 ? w * 2 : w) : Math.max(1, img.naturalWidth || w);
  const outH = isSvg ? (h < 256 ? h * 2 : h) : Math.max(1, img.naturalHeight || h);
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, outW, outH);
    ctx.drawImage(img, 0, 0, outW, outH);
  }
  return Texture.from(canvas);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number): number {
  return a + normalizeAngleDiff(b, a) * t;
}

const FACTION_COLOR: Record<Faction, number> = {
  blue: 0x38bdf8,
  red: 0xef4444,
  neutral: 0x94a3b8
};

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  radius: number;
  color: number;
}

export interface EditorOverlayState {
  enabled: boolean;
  showNavGrid: boolean;
  paintActive: boolean;
  draftZonePoints: Point[];
}

interface EntityView {
  container: Container;
  sprite: Sprite;
  shadow: Graphics;
  factionHalo: Graphics;
  ring: Graphics;
  buildArc: Graphics;
}

interface CalloutView {
  container: Container;
  bg: Graphics;
  label: Text;
  lastText: string;
  lastColor: string;
}

export class StudioRenderer {
  public app = new Application();
  private world = new Container();
  private mapLayer = new Container();
  private geoHoverGraphics = new Graphics();
  private geoSelectGraphics = new Graphics();
  private navOverlay = new Graphics();
  private zoneGraphics = new Graphics();
  private pathGraphics = new Graphics();
  private arrowGraphics = new Graphics();
  private pulseGraphics = new Graphics();
  private particleGraphics = new Graphics();
  private anchorLayer = new Container();
  private entityLayer = new Container();
  private calloutLayer = new Container();

  private actorTextures = new Map<string, Texture>();
  private entityViews = new Map<string, EntityView>();
  private calloutViews = new Map<string, CalloutView>();
  private particles: Particle[] = [];

  private camX = 600;
  private camY = 400;
  private camZoom = 1;
  private lastCamSeq = -1;
  private dragging = false;
  private painting = false;
  private dragMoved = false;
  private lastPointer: Point = { x: 0, y: 0 };
  private mapWidth = 1200;
  private mapHeight = 800;
  private currentHitTest?: (pt: Point) => string | null;

  public selectedEntityId: string | null = null;
  public hoveredRegionId: string | null = null;
  public selectedRegionId: string | null = null;
  public hideUIHelpers = false;
  public showAnchors = true;
  public editorOverlay: EditorOverlayState = {
    enabled: false,
    showNavGrid: false,
    paintActive: false,
    draftZonePoints: []
  };

  public onMapClick?: (worldPt: Point, clickedEntityId: string | null) => void;
  public onMapPaint?: (worldPt: Point) => void;
  public onSelectionChange?: (entityId: string | null) => void;
  public onRegionHover?: (regionId: string | null) => void;
  public onRegionDoubleClick?: (regionId: string) => void;

  private cleanupListeners: Array<() => void> = [];
  private destroyed = false;

  async init(host: HTMLElement): Promise<void> {
    try {
      await this.app.init({
        resizeTo: host,
        backgroundColor: 0x090f1a,
        antialias: true,
        preference: 'webgl',
        preserveDrawingBuffer: true
      });
    } catch {
      await this.app.init({
        resizeTo: host,
        backgroundColor: 0x090f1a,
        antialias: true,
        preserveDrawingBuffer: true
      });
    }
    if (this.destroyed) return;
    this.app.canvas.style.display = 'block';
    this.app.canvas.style.width = '100%';
    this.app.canvas.style.height = '100%';
    this.app.canvas.setAttribute('data-testid', 'studio-canvas');
    host.appendChild(this.app.canvas);

    this.world.addChild(
      this.mapLayer,
      this.geoHoverGraphics,
      this.geoSelectGraphics,
      this.navOverlay,
      this.zoneGraphics,
      this.pathGraphics,
      this.arrowGraphics,
      this.pulseGraphics,
      this.particleGraphics,
      this.anchorLayer,
      this.entityLayer,
      this.calloutLayer
    );
    this.app.stage.addChild(this.world);
    this.setupPointerEvents();
  }

  private screenToWorld(clientX: number, clientY: number): Point {
    const rect = this.app.canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    return {
      x: (sx - this.app.screen.width / 2) / this.camZoom + this.camX,
      y: (sy - this.app.screen.height / 2) / this.camZoom + this.camY
    };
  }

  private setupPointerEvents(): void {
    const canvas = this.app.canvas;

    const onPointerDown = (e: PointerEvent) => {
      if (this.editorOverlay.enabled && (e.shiftKey || (this.editorOverlay.paintActive && e.button === 0))) {
        this.painting = true;
        this.dragging = true;
        this.dragMoved = true;
        this.onMapPaint?.(this.screenToWorld(e.clientX, e.clientY));
        return;
      }
      this.painting = false;
      this.dragging = true;
      this.dragMoved = false;
      this.lastPointer = { x: e.clientX, y: e.clientY };
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!this.dragging) return;
      if (this.painting || (this.editorOverlay.enabled && e.shiftKey)) {
        this.onMapPaint?.(this.screenToWorld(e.clientX, e.clientY));
        return;
      }
      const dx = e.clientX - this.lastPointer.x;
      const dy = e.clientY - this.lastPointer.y;
      if (Math.hypot(dx, dy) > 4) {
        this.dragMoved = true;
        this.lastCamSeq = Number.MAX_SAFE_INTEGER;
      }
      this.camX -= dx / this.camZoom;
      this.camY -= dy / this.camZoom;
      this.lastPointer = { x: e.clientX, y: e.clientY };
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!this.dragging) return;
      const wasPainting = this.painting;
      this.dragging = false;
      this.painting = false;
      if (!wasPainting && !this.dragMoved && e.target === canvas) {
        const pt = this.screenToWorld(e.clientX, e.clientY);
        const hit = this.pickEntity(pt.x, pt.y);
        this.onMapClick?.(pt, hit);
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      this.lastCamSeq = Number.MAX_SAFE_INTEGER;
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      this.camZoom = Math.max(0.35, Math.min(4, this.camZoom * factor));
    };

    const onCanvasHoverMove = (e: PointerEvent) => {
      if (this.dragging || !this.currentHitTest) return;
      const pt = this.screenToWorld(e.clientX, e.clientY);
      const hit = this.currentHitTest(pt);
      if (hit !== this.hoveredRegionId) {
        this.hoveredRegionId = hit;
        this.onRegionHover?.(hit);
      }
    };

    const onCanvasDblClick = (e: MouseEvent) => {
      if (!this.currentHitTest) return;
      const pt = this.screenToWorld(e.clientX, e.clientY);
      const hit = this.currentHitTest(pt);
      if (hit) this.onRegionDoubleClick?.(hit);
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onCanvasHoverMove);
    canvas.addEventListener('dblclick', onCanvasDblClick);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    this.cleanupListeners.push(() => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onCanvasHoverMove);
      canvas.removeEventListener('dblclick', onCanvasDblClick);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
    });
  }

  private pickEntity(wx: number, wy: number): string | null {
    for (const [id, view] of this.entityViews) {
      if (Math.hypot(view.container.x - wx, view.container.y - wy) <= 30) return id;
    }
    return null;
  }

  private computeClampedCameraGoal(targetX: number, targetY: number, targetZoom: number): { x: number; y: number } {
    const halfW = this.app.screen.width / (2 * targetZoom);
    const halfH = this.app.screen.height / (2 * targetZoom);
    return {
      x:
        halfW * 2 >= this.mapWidth
          ? this.mapWidth / 2
          : Math.max(halfW, Math.min(this.mapWidth - halfW, targetX)),
      y:
        halfH * 2 >= this.mapHeight
          ? this.mapHeight / 2
          : Math.max(halfH, Math.min(this.mapHeight - halfH, targetY))
    };
  }

  zoomBy(factor: number): void {
    this.lastCamSeq = Number.MAX_SAFE_INTEGER;
    this.camZoom = Math.max(0.35, Math.min(4, this.camZoom * factor));
  }

  resetCamera(): void {
    this.lastCamSeq = Number.MAX_SAFE_INTEGER;
    this.camX = this.mapWidth / 2;
    this.camY = this.mapHeight / 2;
    const sw = Math.max(1, this.app.screen.width);
    const sh = Math.max(1, this.app.screen.height);
    this.camZoom = Math.min(sw / this.mapWidth, sh / this.mapHeight) * 0.94;
  }

  resumeCameraTracking(): void {
    this.lastCamSeq = -1;
  }

  syncCameraImmediate(engine: StudioEngine): void {
    if (engine.cameraTarget) {
      const clamped = this.computeClampedCameraGoal(
        engine.cameraTarget.x,
        engine.cameraTarget.y,
        engine.cameraTarget.zoom
      );
      this.camX = clamped.x;
      this.camY = clamped.y;
      this.camZoom = engine.cameraTarget.zoom;
      this.lastCamSeq = engine.cameraTarget.seq;
    }
    this.particles = [];
  }

  async syncActorTextures(actors: Record<string, { id: string; svg: string }>): Promise<void> {
    for (const actor of Object.values(actors)) {
      if (!this.actorTextures.has(actor.id)) {
        this.actorTextures.set(actor.id, await loadSvgOrUrlTexture(actor.svg, 64, 64));
      }
    }
  }

  focusRegion(engine: StudioEngine, regionId: string, zoomBoost = 3.2): void {
    const reg = engine.map.regions?.[regionId];
    if (!reg) return;
    const rw = Math.max(40, reg.bounds.maxX - reg.bounds.minX);
    const rh = Math.max(40, reg.bounds.maxY - reg.bounds.minY);
    const sw = Math.max(1, this.app.screen.width);
    const sh = Math.max(1, this.app.screen.height);
    const fitZoom = Math.min(sw / rw, sh / rh) * 0.65;
    engine.cameraTarget = {
      x: reg.center.x,
      y: reg.center.y,
      zoom: Math.max(1.2, Math.min(zoomBoost, fitZoom)),
      durationSec: 0.8,
      seq: (engine.cameraTarget?.seq ?? 0) + 1
    };
  }

  private drawRegionHighlight(
    g: Graphics,
    engine: StudioEngine,
    regionId: string | null,
    fillColor: number,
    fillAlpha: number,
    strokeColor: number,
    strokeWidth: number
  ): void {
    g.clear();
    if (!regionId || !engine.map.regions || this.hideUIHelpers) return;
    const reg = engine.map.regions[regionId];
    if (!reg) return;
    for (const poly of reg.polygons) {
      if (poly.length < 3) continue;
      const flat = poly.flatMap((p) => [p.x, p.y]);
      g.poly(flat, true)
        .fill({ color: fillColor, alpha: fillAlpha })
        .stroke({ width: strokeWidth / Math.max(0.4, this.camZoom), color: strokeColor, alpha: 0.95 });
    }
  }

  refreshAnchors(map: MapPack): void {
    this.anchorLayer.removeChildren();
    if (map.geoLevel === 'world' && !this.editorOverlay.enabled) return;
    for (const [id, pt] of Object.entries(map.anchors)) {
      const dot = new Graphics()
        .circle(0, 0, 5)
        .fill({ color: 0xfef08a, alpha: 0.92 })
        .stroke({ width: 2, color: 0x0f172a });
      dot.position.set(pt.x, pt.y);
      const anchorText =
        map.geoLevel === 'country'
          ? id
          : pt.label && pt.label !== id
            ? `${pt.label} (${id})`
            : id;
      const label = new Text({
        text: anchorText,
        style: {
          fontFamily: 'IBM Plex Sans Arabic, system-ui, sans-serif',
          fontSize: map.geoLevel === 'country' ? 10 : 12,
          fontWeight: '600',
          fill: map.geoLevel === 'country' ? 0xbae6fd : 0xe2e8f0,
          stroke: { color: 0x090f1a, width: 3.5 }
        }
      });
      label.anchor.set(0.5, 1);
      label.position.set(pt.x, pt.y - 9);
      this.anchorLayer.addChild(dot, label);
    }
  }

  async loadEngineAssets(engine: StudioEngine): Promise<void> {
    this.mapLayer.removeChildren();
    this.entityLayer.removeChildren();
    this.calloutLayer.removeChildren();
    this.geoHoverGraphics.clear();
    this.geoSelectGraphics.clear();
    this.entityViews.clear();
    this.calloutViews.clear();
    this.particles = [];
    this.selectedEntityId = null;
    this.hoveredRegionId = null;
    this.selectedRegionId = null;
    this.currentHitTest = engine.map.hitTest;
    this.onSelectionChange?.(null);

    this.mapWidth = engine.map.width;
    this.mapHeight = engine.map.height;

    const mapTex = await loadSvgOrUrlTexture(engine.map.svgOrUrl, engine.map.width, engine.map.height);
    if (this.destroyed) return;
    const mapSprite = new Sprite(mapTex);
    mapSprite.width = engine.map.width;
    mapSprite.height = engine.map.height;
    const mapFrame = new Graphics()
      .rect(0, 0, engine.map.width, engine.map.height)
      .stroke({ width: 2, color: 0x334155, alpha: 0.9 });
    this.mapLayer.addChild(mapSprite, mapFrame);

    this.refreshAnchors(engine.map);
    await this.syncActorTextures(engine.actors);

    this.camX = engine.map.width / 2;
    this.camY = engine.map.height / 2;
    const sw = Math.max(1, this.app.screen.width);
    const sh = Math.max(1, this.app.screen.height);
    this.camZoom = Math.min(sw / engine.map.width, sh / engine.map.height) * 0.94;
    this.lastCamSeq = -1;
  }

  render(engine: StudioEngine, alpha: number, timeSec: number, frameDt = 0.016, isPlaying = true): void {
    if (this.destroyed) return;
    this.anchorLayer.visible = !this.hideUIHelpers && this.showAnchors;

    if (
      engine.cameraTarget &&
      engine.cameraTarget.seq !== this.lastCamSeq &&
      this.lastCamSeq !== Number.MAX_SAFE_INTEGER
    ) {
      const targetZoom = engine.cameraTarget.zoom;
      const goal = this.computeClampedCameraGoal(engine.cameraTarget.x, engine.cameraTarget.y, targetZoom);
      const speedFactor = 1 - Math.exp((-frameDt * 3.6) / Math.max(0.25, engine.cameraTarget.durationSec));
      this.camX = lerp(this.camX, goal.x, speedFactor);
      this.camY = lerp(this.camY, goal.y, speedFactor);
      this.camZoom = lerp(this.camZoom, targetZoom, speedFactor);
      if (
        Math.hypot(this.camX - goal.x, this.camY - goal.y) < 0.8 &&
        Math.abs(this.camZoom - targetZoom) < 0.005
      ) {
        this.lastCamSeq = engine.cameraTarget.seq;
      }
    }

    this.world.position.set(this.app.screen.width / 2, this.app.screen.height / 2);
    this.world.scale.set(this.camZoom);
    this.world.pivot.set(this.camX, this.camY);

    // تمييز الدولة أو المحافظة عند التمرير والتحديد
    this.drawRegionHighlight(this.geoHoverGraphics, engine, this.hoveredRegionId, 0x38bdf8, 0.2, 0x38bdf8, 1.8);
    this.drawRegionHighlight(this.geoSelectGraphics, engine, this.selectedRegionId, 0xf59e0b, 0.24, 0xf59e0b, 2.6);

    // طبقة شبكة الملاحة ومسودة المناطق في وضع صانع الخرائط
    this.navOverlay.clear();
    if (this.editorOverlay.enabled && this.editorOverlay.showNavGrid) {
      const m = engine.map;
      for (let y = 0; y < m.rows; y++) {
        for (let x = 0; x < m.cols; x++) {
          const cell = m.navGrid[y * m.cols + x];
          if (cell === 1) {
            this.navOverlay
              .rect(x * m.cellSize, y * m.cellSize, m.cellSize, m.cellSize)
              .fill({ color: 0x38bdf8, alpha: 0.25 });
          } else if (cell === 2) {
            this.navOverlay
              .rect(x * m.cellSize, y * m.cellSize, m.cellSize, m.cellSize)
              .fill({ color: 0xef4444, alpha: 0.35 });
          }
        }
      }
    }
    if (this.editorOverlay.enabled && this.editorOverlay.draftZonePoints.length > 0) {
      const pts = this.editorOverlay.draftZonePoints;
      pts.forEach((p) => this.navOverlay.circle(p.x, p.y, 5).fill({ color: 0xf472b6 }));
      if (pts.length > 1) {
        this.navOverlay.poly(pts.flatMap((p) => [p.x, p.y]), false).stroke({ width: 2, color: 0xf472b6 });
      }
    }

    // المناطق
    this.zoneGraphics.clear();
    for (const zState of engine.zones.values()) {
      if (zState.opacity <= 0.01) continue;
      const def = engine.map.zones[zState.id];
      if (!def) continue;
      const pts = def.polygon.flatMap((p) => [p.x, p.y]);
      this.zoneGraphics
        .poly(pts, true)
        .fill({ color: zState.color, alpha: zState.opacity })
        .stroke({ width: 2, color: zState.color, alpha: 0.85 });
    }

    // رسم مسار A* للوحدة المحددة
    this.pathGraphics.clear();
    if (!this.hideUIHelpers && this.selectedEntityId) {
      const sel = engine.entities.get(this.selectedEntityId);
      if (sel && sel.path.length > 0) {
        let px = lerp(sel.prevX, sel.x, alpha);
        let py = lerp(sel.prevY, sel.y, alpha);
        for (const wp of sel.path) {
          this.pathGraphics.moveTo(px, py).lineTo(wp.x, wp.y).stroke({ width: 2, color: 0x22c55e, alpha: 0.65 });
          px = wp.x;
          py = wp.y;
        }
        const dest = sel.path[sel.path.length - 1];
        this.pathGraphics.circle(dest.x, dest.y, 5).stroke({ width: 2, color: 0x22c55e, alpha: 0.85 });
      }
    }

    // الأسهم
    this.arrowGraphics.clear();
    for (const arr of engine.arrows.values()) {
      const mx = (arr.from.x + arr.to.x) / 2;
      const my = (arr.from.y + arr.to.y) / 2 - 55;
      const steps = 24;
      const maxStep = Math.max(1, Math.floor(steps * arr.progress));
      let prev = arr.from;
      for (let i = 1; i <= maxStep; i++) {
        const t = i / steps;
        const x = (1 - t) * (1 - t) * arr.from.x + 2 * (1 - t) * t * mx + t * t * arr.to.x;
        const y = (1 - t) * (1 - t) * arr.from.y + 2 * (1 - t) * t * my + t * t * arr.to.y;
        if (!arr.dashed || i % 2 === 1) {
          this.arrowGraphics.moveTo(prev.x, prev.y).lineTo(x, y).stroke({ width: 4, color: arr.color, alpha: 0.9 });
        }
        prev = { x, y };
      }
      if (arr.progress > 0.15) {
        const ang = Math.atan2(prev.y - my, prev.x - mx);
        this.arrowGraphics
          .poly([
            prev.x + Math.cos(ang) * 10,
            prev.y + Math.sin(ang) * 10,
            prev.x + Math.cos(ang + 2.5) * 10,
            prev.y + Math.sin(ang + 2.5) * 10,
            prev.x + Math.cos(ang - 2.5) * 10,
            prev.y + Math.sin(ang - 2.5) * 10
          ])
          .fill({ color: arr.color });
      }
    }

    // موجات التنبيه (Pulses)
    this.pulseGraphics.clear();
    for (const p of engine.pulses) {
      const r = 10 + p.maxRadius * p.progress;
      this.pulseGraphics
        .circle(p.x, p.y, r)
        .stroke({ width: 3, color: p.color, alpha: Math.max(0, 1 - p.progress) });
    }

    // الكيانات + جزيئات الحركة الإجرائية
    for (const [id, v] of this.entityViews) {
      if (!engine.entities.has(id)) {
        this.entityLayer.removeChild(v.container);
        v.container.destroy({ children: true });
        this.entityViews.delete(id);
      }
    }

    for (const ent of engine.entities.values()) {
      let view = this.entityViews.get(ent.id);
      if (!view) {
        view = this.createEntityView(ent);
        this.entityViews.set(ent.id, view);
        this.entityLayer.addChild(view.container);
      }
      const x = lerp(ent.prevX, ent.x, alpha);
      const y = lerp(ent.prevY, ent.y, alpha);
      view.container.position.set(x, y);

      if (ent.kind === 'person') {
        const bob = ent.isMoving ? Math.abs(Math.sin(timeSec * 12)) * 3 : 0;
        view.sprite.y = -bob;
        view.sprite.rotation = ent.isMoving ? Math.sin(timeSec * 12) * 0.08 : 0;
      } else if (ent.kind === 'vehicle' || ent.kind === 'ship') {
        view.sprite.rotation = lerpAngle(ent.prevAngle, ent.angle, alpha);
      }

      if (isPlaying && ent.isMoving && Math.random() < 0.35 && this.particles.length < 180) {
        this.particles.push({
          x: x - Math.cos(ent.angle) * (ent.radius * 0.7),
          y: y - Math.sin(ent.angle) * (ent.radius * 0.7),
          vx: (Math.random() - 0.5) * 14,
          vy: (Math.random() - 0.5) * 14,
          life: 0.65,
          maxLife: 0.65,
          radius: ent.domain === 'sea' ? 4.2 : 3,
          color: ent.domain === 'sea' ? 0xbae6fd : 0xd6d3d1
        });
      }

      view.sprite.alpha = ent.buildProgress < 1 ? 0.35 + ent.buildProgress * 0.65 : 1;
      view.buildArc.clear();
      if (ent.buildProgress < 1) {
        view.buildArc
          .arc(0, 0, ent.radius + 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ent.buildProgress)
          .stroke({ width: 3, color: 0x38bdf8 });
      }
      view.ring.visible = !this.hideUIHelpers && this.selectedEntityId === ent.id;
    }

    // تحديث ورسم الجزيئات
    this.particleGraphics.clear();
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.x += pt.vx * frameDt;
      pt.y += pt.vy * frameDt;
      pt.life -= frameDt;
      if (pt.life <= 0) {
        this.particles.splice(i, 1);
      } else {
        const ratio = pt.life / pt.maxLife;
        this.particleGraphics
          .circle(pt.x, pt.y, pt.radius * ratio)
          .fill({ color: pt.color, alpha: ratio * 0.55 });
      }
    }

    // تحديث البطاقات العائمة (Callouts)
    for (const [id, cv] of this.calloutViews) {
      if (!engine.callouts.has(id)) {
        this.calloutLayer.removeChild(cv.container);
        cv.container.destroy({ children: true });
        this.calloutViews.delete(id);
      }
    }
    for (const c of engine.callouts.values()) {
      const targetEnt = engine.entities.get(c.target);
      const targetAnchor = engine.map.anchors[c.target];
      const tx = targetEnt ? lerp(targetEnt.prevX, targetEnt.x, alpha) : targetAnchor?.x;
      const ty = targetEnt
        ? lerp(targetEnt.prevY, targetEnt.y, alpha) - 38
        : targetAnchor
          ? targetAnchor.y - 46
          : undefined;
      if (tx === undefined || ty === undefined) continue;

      let cv = this.calloutViews.get(c.id);
      if (!cv) {
        const container = new Container();
        const bg = new Graphics();
        const label = new Text({
          text: c.text,
          style: {
            fontFamily: 'IBM Plex Sans Arabic, system-ui, sans-serif',
            fontSize: 12,
            fontWeight: '600',
            fill: 0xf8fafc
          }
        });
        label.anchor.set(0.5);
        container.addChild(bg, label);
        this.calloutLayer.addChild(container);
        cv = { container, bg, label, lastText: '', lastColor: '' };
        this.calloutViews.set(c.id, cv);
      }
      if (cv.lastText !== c.text || cv.lastColor !== c.color) {
        cv.label.text = c.text;
        cv.lastText = c.text;
        cv.lastColor = c.color;
        const w = cv.label.width + 20;
        const h = 26;
        cv.bg
          .clear()
          .roundRect(-w / 2, -h / 2, w, h, 6)
          .fill({ color: 0x0f172a, alpha: 0.94 })
          .stroke({ width: 1.5, color: c.color });
      }
      cv.container.position.set(tx, ty);
    }
  }

  private createEntityView(ent: EntityState): EntityView {
    const container = new Container();
    const shadow = new Graphics()
      .ellipse(0, ent.scale * 0.32, ent.radius * 0.9, ent.radius * 0.4)
      .fill({ color: 0x000000, alpha: 0.38 });
    const factionHalo = new Graphics()
      .circle(0, 0, ent.radius + 2)
      .stroke({ width: 2, color: FACTION_COLOR[ent.faction], alpha: 0.65 });
    const ring = new Graphics().circle(0, 0, ent.radius + 7).stroke({ width: 2.5, color: 0x22c55e });
    ring.visible = false;
    const buildArc = new Graphics();

    const tex = this.actorTextures.get(ent.actorId) ?? Texture.EMPTY;
    const sprite = new Sprite(tex);
    sprite.anchor.set(0.5);
    const ratio = ent.scale / Math.max(1, tex.height);
    sprite.scale.set(ratio);

    container.addChild(shadow, factionHalo, ring, sprite, buildArc);
    return { container, sprite, shadow, ring, factionHalo, buildArc };
  }

  destroy(): void {
    this.destroyed = true;
    this.cleanupListeners.forEach((fn) => fn());
    this.cleanupListeners = [];
    try {
      this.app.destroy(true, { children: true });
    } catch {
      // Ignore destroy errors if init hadn't finished
    }
  }
}

import { Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { StudioEngine, normalizeAngleDiff } from '../core/engine';
import { EntityState, Faction, MapPack, Point } from '../core/types';
import { sanitizeAssetUrl } from '../packs/packSchema';

async function loadSvgOrUrlTexture(src: string, fallbackW = 128, fallbackH = 128): Promise<Texture> {
  const safeSrc = sanitizeAssetUrl(src);
  if (!safeSrc) return Texture.EMPTY;
  const isSvg = safeSrc.startsWith('<svg');
  let url = safeSrc;
  let w = fallbackW;
  let h = fallbackH;

  if (isSvg) {
    const vbMatch = safeSrc.match(/viewBox=["']\s*[\d.-]+\s+[\d.-]+\s+([\d.]+)\s+([\d.]+)\s*["']/i);
    if (vbMatch) {
      w = Math.max(1, Math.round(parseFloat(vbMatch[1])));
      h = Math.max(1, Math.round(parseFloat(vbMatch[2])));
    }
    let normalizedSvg = safeSrc;
    if (!/\bwidth=/.test(normalizedSvg.slice(0, 220))) {
      normalizedSvg = normalizedSvg.replace('<svg', `<svg width="${w}" height="${h}"`);
    }
    url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(normalizedSvg)}`;
  }

  const img = new Image();
  img.crossOrigin = 'anonymous';
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Failed to load texture image'));
      img.src = url;
    });
  } catch {
    return Texture.EMPTY;
  }
  if (img.decode) {
    try {
      await img.decode();
    } catch {
      // Already decoded on load
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

function easeOutCubic(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - clamped, 3);
}

function lerpAngle(a: number, b: number, t: number): number {
  return a + normalizeAngleDiff(b, a) * t;
}

const FACTION_COLOR: Record<Faction, number> = {
  blue: 0x38bdf8,
  red: 0xf87171,
  neutral: 0xcbd5e1
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

interface WakeRipple {
  x: number;
  y: number;
  angle: number;
  width: number;
  life: number;
  maxLife: number;
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
  baseSpriteScale: number;
  isElongated: boolean;
  shadow: Graphics;
  glow: Graphics;
  factionHalo: Graphics;
  ring: Graphics;
  buildArc: Graphics;
  rotor?: Graphics;
  visX: number;
  visY: number;
  visAngle: number;
  initialized: boolean;
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
  private craterGraphics = new Graphics();
  private wakeGraphics = new Graphics();
  private pathGraphics = new Graphics();
  private arrowGraphics = new Graphics();
  private pulseGraphics = new Graphics();
  private particleGraphics = new Graphics();
  private anchorLayer = new Container();
  private entityLayer = new Container();
  private projectileGraphics = new Graphics();
  private explosionGraphics = new Graphics();
  private calloutLayer = new Container();
  private ambientGraphics = new Graphics();
  private diagramLayer = new Container();
  private diagramBuilt = false;

  private actorTextures = new Map<string, Texture>();
  private entityViews = new Map<string, EntityView>();
  private calloutViews = new Map<string, CalloutView>();
  private particles: Particle[] = [];
  private wakeRipples: WakeRipple[] = [];

  private camX = 600;
  private camY = 400;
  private camZoom = 1;
  private manualCamGoal: { x: number; y: number; zoom: number } | null = null;
  private lastCamSeq = -1;
  private currentTargetSeq = 0;
  private dragging = false;
  private painting = false;
  private dragMoved = false;
  private lastPointer: Point = { x: 0, y: 0 };
  private mapWidth = 1200;
  private mapHeight = 800;
  private lastUnitFactor = 1;
  private currentHitTest?: (pt: Point) => string | null;

  public userUnitScale = 1.0;
  public selectedEntityId: string | null = null;
  public hoveredRegionId: string | null = null;
  public selectedRegionId: string | null = null;
  public hideUIHelpers = false;
  public showAnchors = true;
  public showArchitectureDiagram = false;
  public editorOverlay: EditorOverlayState = {
    enabled: false,
    showNavGrid: false,
    paintActive: false,
    draftZonePoints: []
  };

  getCameraState(): { x: number; y: number; zoom: number } {
    return { x: this.camX, y: this.camY, zoom: this.camZoom };
  }

  public onMapClick?: (worldPt: Point, clickedEntityId: string | null, shiftKey?: boolean) => void;
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
        backgroundColor: 0x0b1220,
        antialias: true,
        preference: 'webgl',
        preserveDrawingBuffer: true
      });
    } catch {
      await this.app.init({
        resizeTo: host,
        backgroundColor: 0x0b1220,
        antialias: true,
        preserveDrawingBuffer: true
      });
    }
    if (this.destroyed) return;
    this.app.canvas.style.display = 'block';
    this.app.canvas.style.width = '100%';
    this.app.canvas.style.height = '100%';
    this.app.canvas.style.touchAction = 'none';
    this.app.canvas.setAttribute('data-testid', 'studio-canvas');
    host.appendChild(this.app.canvas);

    this.world.addChild(
      this.mapLayer,
      this.geoHoverGraphics,
      this.geoSelectGraphics,
      this.navOverlay,
      this.zoneGraphics,
      this.craterGraphics,
      this.wakeGraphics,
      this.pathGraphics,
      this.arrowGraphics,
      this.pulseGraphics,
      this.particleGraphics,
      this.anchorLayer,
      this.entityLayer,
      this.projectileGraphics,
      this.explosionGraphics,
      this.ambientGraphics,
      this.calloutLayer
    );
    this.diagramLayer.visible = false;
    this.app.stage.addChild(this.world, this.diagramLayer);
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

    // Active touch/mouse pointers, used for pinch-zoom and two-finger pan.
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch: { dist: number; zoom: number; worldX: number; worldY: number } | null = null;

    const pinchMetrics = () => {
      const [a, b] = [...pointers.values()];
      return {
        dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      };
    };

    const onPointerDown = (e: PointerEvent) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const m = pinchMetrics();
        const w = this.screenToWorld(m.mid.x, m.mid.y);
        pinch = { dist: m.dist, zoom: this.camZoom, worldX: w.x, worldY: w.y };
        this.dragging = false;
        this.painting = false;
        this.dragMoved = true;
        return;
      }
      if (pointers.size > 2) return;
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
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pointers.size >= 2) {
        const m = pinchMetrics();
        const zoom = Math.max(0.35, Math.min(4, pinch.zoom * (m.dist / pinch.dist)));
        const r = canvas.getBoundingClientRect();
        const lx = m.mid.x - r.left;
        const ly = m.mid.y - r.top;
        // Keep the world point under the initial pinch midpoint anchored under the fingers.
        this.camZoom = zoom;
        this.camX = pinch.worldX - (lx - this.app.screen.width / 2) / zoom;
        this.camY = pinch.worldY - (ly - this.app.screen.height / 2) / zoom;
        this.lastCamSeq = this.currentTargetSeq;
        return;
      }
      if (!this.dragging) return;
      if (this.painting || (this.editorOverlay.enabled && e.shiftKey)) {
        this.onMapPaint?.(this.screenToWorld(e.clientX, e.clientY));
        return;
      }
      const dx = e.clientX - this.lastPointer.x;
      const dy = e.clientY - this.lastPointer.y;
      if (Math.hypot(dx, dy) > 4) {
        this.dragMoved = true;
        this.lastCamSeq = this.currentTargetSeq;
      }
      this.camX -= dx / this.camZoom;
      this.camY -= dy / this.camZoom;
      this.lastPointer = { x: e.clientX, y: e.clientY };
    };

    const onPointerUp = (e: PointerEvent) => {
      const wasPinching = pinch !== null;
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (wasPinching) {
        // Ending a pinch must not turn the remaining finger into a tap.
        this.dragging = false;
        this.dragMoved = true;
        return;
      }
      if (!this.dragging) return;
      const wasPainting = this.painting;
      this.dragging = false;
      this.painting = false;
      if (!wasPainting && !this.dragMoved && e.target === canvas) {
        const pt = this.screenToWorld(e.clientX, e.clientY);
        const hit = this.pickEntity(pt.x, pt.y);
        this.onMapClick?.(pt, hit, e.shiftKey);
      }
    };

    const onPointerCancel = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      this.dragging = false;
      this.painting = false;
      this.dragMoved = true;
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      this.lastCamSeq = this.currentTargetSeq;
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
    window.addEventListener('pointercancel', onPointerCancel);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    this.cleanupListeners.push(() => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onCanvasHoverMove);
      canvas.removeEventListener('dblclick', onCanvasDblClick);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('wheel', onWheel);
    });
  }

  private pickEntity(wx: number, wy: number): string | null {
    for (const [id, view] of this.entityViews) {
      const hitRadius = Math.max(16 / this.camZoom, 24 * view.container.scale.x);
      if (Math.hypot(view.container.x - wx, view.container.y - wy) <= hitRadius) return id;
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

  setArchitectureDiagramVisible(visible: boolean): void {
    this.showArchitectureDiagram = visible;
    this.diagramLayer.visible = visible;
  }

  zoomBy(factor: number): void {
    this.lastCamSeq = this.currentTargetSeq;
    const baseZoom = this.manualCamGoal ? this.manualCamGoal.zoom : this.camZoom;
    const targetZoom = Math.max(0.35, Math.min(4, baseZoom * factor));
    const clamped = this.computeClampedCameraGoal(this.camX, this.camY, targetZoom);
    this.manualCamGoal = { x: clamped.x, y: clamped.y, zoom: targetZoom };
  }

  resetCamera(): void {
    this.lastCamSeq = this.currentTargetSeq;
    const sw = Math.max(1, this.app.screen.width);
    const sh = Math.max(1, this.app.screen.height);
    const targetZoom = Math.min(sw / this.mapWidth, sh / this.mapHeight) * 0.94;
    this.manualCamGoal = {
      x: this.mapWidth / 2,
      y: this.mapHeight / 2,
      zoom: targetZoom
    };
  }

  resumeCameraTracking(): void {
    this.manualCamGoal = null;
    this.lastCamSeq = -1;
  }

  syncCameraImmediate(engine: StudioEngine): void {
    this.manualCamGoal = null;
    if (engine.cameraTarget) {
      this.currentTargetSeq = engine.cameraTarget.seq;
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
    this.wakeRipples = [];
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
    this.craterGraphics.clear();
    this.wakeGraphics.clear();
    this.projectileGraphics.clear();
    this.explosionGraphics.clear();
    this.entityViews.clear();
    this.calloutViews.clear();
    this.particles = [];
    this.wakeRipples = [];
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
    this.currentTargetSeq = engine.cameraTarget?.seq ?? 0;
    this.lastCamSeq = -1;
  }

  render(engine: StudioEngine, alpha: number, timeSec: number, frameDt = 0.016, isPlaying = true): void {
    if (this.destroyed) return;
    this.anchorLayer.visible = !this.hideUIHelpers && this.showAnchors;
    if (engine.cameraTarget) {
      this.currentTargetSeq = engine.cameraTarget.seq;
    }

    if (this.manualCamGoal) {
      const t = easeOutCubic(Math.min(1, frameDt * 8.5));
      this.camX = lerp(this.camX, this.manualCamGoal.x, t);
      this.camY = lerp(this.camY, this.manualCamGoal.y, t);
      this.camZoom = lerp(this.camZoom, this.manualCamGoal.zoom, t);
      if (
        Math.hypot(this.camX - this.manualCamGoal.x, this.camY - this.manualCamGoal.y) < 0.4 &&
        Math.abs(this.camZoom - this.manualCamGoal.zoom) < 0.002
      ) {
        this.camX = this.manualCamGoal.x;
        this.camY = this.manualCamGoal.y;
        this.camZoom = this.manualCamGoal.zoom;
        this.manualCamGoal = null;
      }
    } else if (engine.cameraTarget && engine.cameraTarget.seq !== this.lastCamSeq) {
      const targetZoom = engine.cameraTarget.zoom;
      const goal = this.computeClampedCameraGoal(engine.cameraTarget.x, engine.cameraTarget.y, targetZoom);
      const rawT = 1 - Math.exp((-frameDt * 3.6) / Math.max(0.25, engine.cameraTarget.durationSec));
      const speedFactor = easeOutCubic(rawT);
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

    // اهتزاز كاميرا خفيف لحظة الانفجارات الحية دون التأثير على camX/camY
    let shakeX = 0;
    let shakeY = 0;
    for (const ex of engine.explosions) {
      if (ex.progress < 0.35) {
        const amp = (1 - ex.progress / 0.35) * (ex.kind === 'missile' ? 5.5 : 3.5);
        shakeX += Math.sin(timeSec * 65 + ex.x) * amp;
        shakeY += Math.cos(timeSec * 58 + ex.y) * amp;
      }
    }

    this.world.position.set(this.app.screen.width / 2 + shakeX, this.app.screen.height / 2 + shakeY);
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
          } else if (cell === 3) {
            this.navOverlay
              .rect(x * m.cellSize, y * m.cellSize, m.cellSize, m.cellSize)
              .fill({ color: 0x10b981, alpha: 0.35 });
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

    // فوهات وآثار القصف الأرضية المؤقتة (تبقى قليلًا ثم تتلاشى وتختفي)
    this.craterGraphics.clear();
    for (const c of engine.craters) {
      const fade = Math.max(0, Math.min(1, (c.life / Math.max(0.1, c.maxLife)) * 1.8));
      if (fade <= 0.01) continue;
      this.craterGraphics.circle(c.x, c.y, c.radius * 1.32).fill({ color: 0x090d16, alpha: 0.38 * fade });
      this.craterGraphics
        .circle(c.x, c.y, c.radius * 0.7)
        .fill({ color: 0x1e293b, alpha: 0.72 * fade })
        .stroke({ width: 1.8, color: 0x475569, alpha: 0.65 * fade });
      this.craterGraphics.circle(c.x, c.y, c.radius * 0.32).fill({ color: 0x020617, alpha: 0.82 * fade });
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

    // الكيانات + جزيئات الحركة الإجرائية + تموجات البحر
    for (const [id, v] of this.entityViews) {
      if (!engine.entities.has(id)) {
        this.entityLayer.removeChild(v.container);
        v.container.destroy({ children: true });
        this.entityViews.delete(id);
      }
    }

    const mapMul = engine.map.unitScaleMultiplier ?? 1;
    const zoomComp = Math.max(0.45, Math.min(1.25, 1 / Math.pow(this.camZoom, 0.4)));
    this.lastUnitFactor = mapMul * this.userUnitScale * zoomComp;

    for (const ent of engine.entities.values()) {
      let view = this.entityViews.get(ent.id);
      if (!view) {
        view = this.createEntityView(ent);
        this.entityViews.set(ent.id, view);
        this.entityLayer.addChild(view.container);
      }

      const targetX = lerp(ent.prevX, ent.x, alpha);
      const targetY = lerp(ent.prevY, ent.y, alpha);
      const alt = lerp(ent.prevAltitude, ent.altitude, alpha);
      const targetAng = lerpAngle(ent.prevAngle, ent.angle, alpha);

      if (!view.initialized || Math.hypot(targetX - view.visX, targetY - view.visY) > 120) {
        view.visX = targetX;
        view.visY = targetY;
        view.visAngle = targetAng;
        view.initialized = true;
      } else {
        const posEase = easeOutCubic(Math.min(1, frameDt * 18));
        const angEase = easeOutCubic(Math.min(1, frameDt * 14));
        view.visX = lerp(view.visX, targetX, posEase);
        view.visY = lerp(view.visY, targetY, posEase);
        view.visAngle = lerpAngle(view.visAngle, targetAng, angEase);
      }

      const x = view.visX;
      const y = view.visY;
      const smoothAng = view.visAngle;

      const entScale = this.lastUnitFactor * (ent.scaleMul ?? 1);
      view.container.position.set(x, y);
      view.container.scale.set(entScale);

      // تحديث الظل الأرضي المتصل بالارتفاع والاتجاه + تدوير الأقواس التكتيكية
      // الرسوم مرسومة وأنفها للأعلى، لذلك يُضاف 90 درجة إلى زاوية الاتجاه
      const facing = smoothAng + Math.PI / 2;
      if (ent.kind === 'air') {
        view.shadow.position.set(10 + alt * 14, 18 + alt * 22);
        view.shadow.rotation = facing;
        view.shadow.alpha = Math.max(0.18, 0.38 - alt * 0.12);
        view.factionHalo.rotation = facing;
        view.ring.rotation = facing;
      } else if (ent.kind === 'ship' || ent.kind === 'vehicle' || ent.kind === 'person') {
        view.shadow.position.set(2, ent.scale * 0.16);
        view.shadow.rotation = facing;
        view.shadow.alpha = 0.38;
        view.factionHalo.rotation = facing;
        view.ring.rotation = facing;
      }

      // توهج واضح للعنصر المحدد أو النشط
      const isSelected = !this.hideUIHelpers && this.selectedEntityId === ent.id;
      const isActive = ent.isMoving || ent.buildProgress < 1;
      view.glow.clear();
      if (isSelected) {
        const pulse = 0.8 + 0.2 * Math.sin(timeSec * 5.2);
        const r = Math.max(18, ent.radius * 1.35);
        view.glow
          .circle(0, 0, r * 1.25)
          .fill({ color: 0x22c55e, alpha: 0.14 * pulse })
          .circle(0, 0, r * 0.92)
          .fill({ color: 0x38bdf8, alpha: 0.22 * pulse })
          .stroke({ width: 1.8, color: 0x4ade80, alpha: 0.65 * pulse });
      } else if (isActive) {
        const fCol = FACTION_COLOR[ent.faction] ?? 0xcbd5e1;
        const r = Math.max(14, ent.radius * 1.15);
        view.glow
          .circle(0, 0, r)
          .fill({ color: fCol, alpha: 0.1 });
      }

      if (ent.kind === 'person') {
        const bob = ent.isMoving ? Math.abs(Math.sin(timeSec * 12)) * 2 : 0;
        view.sprite.y = -bob;
        view.sprite.rotation = facing;
      } else if (ent.kind === 'vehicle' || ent.kind === 'ship') {
        view.sprite.rotation = facing;
      } else if (ent.kind === 'air') {
        view.sprite.rotation = facing;
        view.sprite.scale.set(view.baseSpriteScale);
        if (view.rotor) {
          view.rotor.rotation = timeSec * (ent.isMoving || alt > 0.05 ? 24 : 7);
        }
      }

      // موجات البحر وذيل الزبد للسفن المبحرة
      if (isPlaying && ent.domain === 'sea') {
        if (ent.isMoving && Math.random() < 0.55 && this.wakeRipples.length < 140) {
          this.wakeRipples.push({
            x: x - Math.cos(smoothAng) * (ent.radius * 0.72 * entScale),
            y: y - Math.sin(smoothAng) * (ent.radius * 0.72 * entScale),
            angle: smoothAng,
            width: Math.max(8, ent.radius * 0.55 * entScale),
            life: 1.5,
            maxLife: 1.5
          });
        }
      }

      // جزيئات غبار الآليات أو عادم/تكاثف الطائرات
      if (isPlaying && ent.isMoving && Math.random() < 0.38 && this.particles.length < 220) {
        if (ent.kind === 'air' && alt > 0.25) {
          this.particles.push({
            x: x - Math.cos(smoothAng) * (ent.radius * 0.85 * entScale),
            y: y - Math.sin(smoothAng) * (ent.radius * 0.85 * entScale),
            vx: (Math.random() - 0.5) * 6,
            vy: (Math.random() - 0.5) * 6,
            life: 0.75,
            maxLife: 0.75,
            radius: 2.5 * entScale,
            color: 0xe2e8f0
          });
        } else if (ent.domain !== 'air') {
          this.particles.push({
            x: x - Math.cos(smoothAng) * (ent.radius * 0.7 * entScale),
            y: y - Math.sin(smoothAng) * (ent.radius * 0.7 * entScale),
            vx: (Math.random() - 0.5) * 14 * entScale,
            vy: (Math.random() - 0.5) * 14 * entScale,
            life: 0.65,
            maxLife: 0.65,
            radius: (ent.domain === 'sea' ? 4.2 : 3) * entScale,
            color: ent.domain === 'sea' ? 0xbae6fd : 0xd6d3d1
          });
        }
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

    // رسم موجات البحر المتوسعة (Kelvin V-wakes + تموج خفيف حول السفن)
    this.wakeGraphics.clear();
    for (let i = this.wakeRipples.length - 1; i >= 0; i--) {
      const w = this.wakeRipples[i];
      w.life -= frameDt;
      if (w.life <= 0) {
        this.wakeRipples.splice(i, 1);
        continue;
      }
      const p = 1 - w.life / w.maxLife;
      const spread = w.width * (0.6 + p * 1.9);
      const back = 12 * p;
      const cos = Math.cos(w.angle);
      const sin = Math.sin(w.angle);
      const perpX = -sin;
      const perpY = cos;
      const tipX = w.x - cos * back;
      const tipY = w.y - sin * back;
      const tailBack = back + 16 * (0.4 + p);
      const leftX = w.x - cos * tailBack + perpX * spread;
      const leftY = w.y - sin * tailBack + perpY * spread;
      const rightX = w.x - cos * tailBack - perpX * spread;
      const rightY = w.y - sin * tailBack - perpY * spread;
      const alphaW = (1 - p) * 0.55;
      this.wakeGraphics
        .moveTo(leftX, leftY)
        .lineTo(tipX, tipY)
        .lineTo(rightX, rightY)
        .stroke({ width: 2.2 * (1 - p * 0.4), color: 0xe0f2fe, alpha: alphaW });
    }
    for (const ent of engine.entities.values()) {
      if (ent.domain !== 'sea') continue;
      const sx = lerp(ent.prevX, ent.x, alpha);
      const sy = lerp(ent.prevY, ent.y, alpha);
      const wavePhase = (timeSec * 0.9 + (ent.x + ent.y) * 0.01) % 1;
      const rWave = ent.radius * (0.95 + wavePhase * 0.55) * this.lastUnitFactor * (ent.scaleMul ?? 1);
      this.wakeGraphics
        .circle(sx, sy, rWave)
        .stroke({ width: 1.5, color: 0x7dd3fc, alpha: (1 - wavePhase) * 0.35 });
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

    // رسم الصواريخ البالستية والقنابل الجوية برسوم متجهة واقعية
    this.projectileGraphics.clear();
    for (const p of engine.projectiles) {
      const gx = lerp(p.prevX, p.x, alpha);
      const gy = lerp(p.prevY, p.y, alpha);
      const arcLift = p.altitude * 48;
      const vy = gy - arcLift;

      // حلقة استهداف تكتيكية متقاطعة على الأرض
      const targetPulse = 0.65 + 0.35 * Math.sin(timeSec * 14);
      const tr = Math.max(11, p.radius * 0.32) * (1 - p.progress * 0.4);
      this.projectileGraphics
        .circle(p.targetX, p.targetY, tr)
        .stroke({ width: 1.5, color: p.color, alpha: 0.65 * targetPulse })
        .moveTo(p.targetX - tr - 3, p.targetY)
        .lineTo(p.targetX - tr + 4, p.targetY)
        .moveTo(p.targetX + tr - 4, p.targetY)
        .lineTo(p.targetX + tr + 3, p.targetY)
        .stroke({ width: 1.5, color: p.color, alpha: 0.75 * targetPulse });

      if (p.mode === 'direct' || p.mode === 'gunfire') {
        // قذيفة مباشرة أو طلقات: خط تتبع مستقيم سريع من فوهة الإطلاق إلى الهدف
        const ux = p.targetX - p.startX;
        const uy = p.targetY - p.startY;
        const ul = Math.hypot(ux, uy) || 1;
        const isDirect = p.mode === 'direct';
        const tailLen = isDirect ? 54 : 22;
        const tailX = gx - (ux / ul) * tailLen;
        const tailY = gy - (uy / ul) * tailLen;
        this.projectileGraphics
          .moveTo(tailX, tailY)
          .lineTo(gx, gy)
          .stroke({ width: isDirect ? 6 : 3, color: p.color, alpha: 0.22 })
          .moveTo(tailX, tailY)
          .lineTo(gx, gy)
          .stroke({ width: isDirect ? 2.6 : 1.4, color: isDirect ? 0xfef3c7 : 0xfef9c3, alpha: 0.95 });
        if (p.progress < 0.12) {
          this.projectileGraphics
            .circle(p.startX, p.startY, isDirect ? 7 : 3)
            .fill({ color: 0xfde68a, alpha: Math.max(0, 0.85 - p.progress * 4) });
        }
        continue;
      }

      if (p.mode === 'missile') {
        // مسار دخان بالستي خلف الصاروخ
        const steps = 10;
        for (let s = 1; s <= steps; s++) {
          const bt = Math.max(0, p.progress - s * 0.028);
          const bx = p.startX + (p.targetX - p.startX) * bt;
          const bAlt = Math.sin(bt * Math.PI) * 1.65 * 48;
          const by = p.startY + (p.targetY - p.startY) * bt - bAlt;
          this.projectileGraphics
            .circle(bx, by, Math.max(1.4, 4.2 - s * 0.32))
            .fill({ color: s <= 2 ? 0xfbbf24 : 0xcbd5e1, alpha: Math.max(0.12, 0.7 - s * 0.065) });
        }

        const nextT = Math.min(1, p.progress + 0.02);
        const nx = p.startX + (p.targetX - p.startX) * nextT;
        const ny = p.startY + (p.targetY - p.startY) * nextT - Math.sin(nextT * Math.PI) * 1.65 * 48;
        const mAng = Math.atan2(ny - vy, nx - gx);
        const cos = Math.cos(mAng);
        const sin = Math.sin(mAng);
        const px = -sin;
        const py = cos;

        // ظل أرضي مستطيل للصاروخ
        this.projectileGraphics
          .poly([
            gx - cos * 9 + px * 2,
            gy - sin * 9 + py * 2,
            gx + cos * 9 + px * 1.5,
            gy + sin * 9 + py * 1.5,
            gx + cos * 9 - px * 1.5,
            gy + sin * 9 - py * 1.5,
            gx - cos * 9 - px * 2,
            gy - sin * 9 - py * 2
          ])
          .fill({ color: 0x000000, alpha: 0.28 });

        // لهب الدفع النفاث في المؤخرة
        this.projectileGraphics
          .poly([
            gx - cos * 9 + px * 2.2,
            vy - sin * 9 + py * 2.2,
            gx - cos * 17,
            vy - sin * 17,
            gx - cos * 9 - px * 2.2,
            vy - sin * 9 - py * 2.2
          ])
          .fill({ color: 0xf97316, alpha: 0.92 })
          .circle(gx - cos * 10, vy - sin * 10, 2.2)
          .fill({ color: 0xfef08a, alpha: 0.95 });

        // زعانف التوجيه الخلفية
        this.projectileGraphics
          .poly([
            gx - cos * 9 + px * 5.2,
            vy - sin * 9 + py * 5.2,
            gx - cos * 4 + px * 2.2,
            vy - sin * 4 + py * 2.2,
            gx - cos * 9 + px * 1.5,
            vy - sin * 9 + py * 1.5
          ])
          .fill({ color: 0x475569 })
          .poly([
            gx - cos * 9 - px * 5.2,
            vy - sin * 9 - py * 5.2,
            gx - cos * 4 - px * 2.2,
            vy - sin * 4 - py * 2.2,
            gx - cos * 9 - px * 1.5,
            vy - sin * 9 - py * 1.5
          ])
          .fill({ color: 0x475569 });

        // جسم الصاروخ الأسطواني المعدني
        this.projectileGraphics
          .poly([
            gx - cos * 9 + px * 2.2,
            vy - sin * 9 + py * 2.2,
            gx + cos * 6 + px * 2.2,
            vy + sin * 6 + py * 2.2,
            gx + cos * 6 - px * 2.2,
            vy + sin * 6 - py * 2.2,
            gx - cos * 9 - px * 2.2,
            vy - sin * 9 - py * 2.2
          ])
          .fill({ color: 0xf1f5f9 })
          .stroke({ width: 0.8, color: 0x334155 });

        // شريط تكتيكي على الجسم
        this.projectileGraphics
          .poly([
            gx - cos * 1 + px * 2.2,
            vy - sin * 1 + py * 2.2,
            gx + cos * 1.8 + px * 2.2,
            vy + sin * 1.8 + py * 2.2,
            gx + cos * 1.8 - px * 2.2,
            vy + sin * 1.8 - py * 2.2,
            gx - cos * 1 - px * 2.2,
            vy - sin * 1 - py * 2.2
          ])
          .fill({ color: 0x334155 });

        // رأس حربي مدبب
        this.projectileGraphics
          .poly([
            gx + cos * 6 + px * 2.2,
            vy + sin * 6 + py * 2.2,
            gx + cos * 13,
            vy + sin * 13,
            gx + cos * 6 - px * 2.2,
            vy + sin * 6 - py * 2.2
          ])
          .fill({ color: 0xdc2626 });
      } else {
        // قنبلة ذكية موجهة JDAM بزعانف
        const dropDx = p.targetX - p.startX;
        const dropDy = p.targetY - p.startY + 55;
        const bAng = Math.atan2(dropDy, dropDx);
        const cos = Math.cos(bAng);
        const sin = Math.sin(bAng);
        const px = -sin;
        const py = cos;

        this.projectileGraphics.ellipse(gx, gy, 4, 2).fill({ color: 0x000000, alpha: 0.28 });
        // زعانف الذيل
        this.projectileGraphics
          .poly([
            gx - cos * 6 + px * 3.5,
            vy - sin * 6 + py * 3.5,
            gx - cos * 2 + px * 1.6,
            vy - sin * 2 + py * 1.6,
            gx - cos * 2 - px * 1.6,
            vy - sin * 2 - py * 1.6,
            gx - cos * 6 - px * 3.5,
            vy - sin * 6 - py * 3.5
          ])
          .fill({ color: 0x475569 });
        // جسم القنبلة
        this.projectileGraphics
          .poly([
            gx - cos * 4 + px * 1.8,
            vy - sin * 4 + py * 1.8,
            gx + cos * 3 + px * 1.8,
            vy + sin * 3 + py * 1.8,
            gx + cos * 6.5,
            vy + sin * 6.5,
            gx + cos * 3 - px * 1.8,
            vy + sin * 3 - py * 1.8,
            gx - cos * 4 - px * 1.8,
            vy - sin * 4 - py * 1.8
          ])
          .fill({ color: 0x334155 })
          .stroke({ width: 0.9, color: 0x94a3b8 });
        // شريط التوجيه الأصفر
        this.projectileGraphics
          .moveTo(gx + cos * 1.5 + px * 1.8, vy + sin * 1.5 + py * 1.8)
          .lineTo(gx + cos * 1.5 - px * 1.8, vy + sin * 1.5 - py * 1.8)
          .stroke({ width: 1.5, color: 0xfbbf24 });
      }
    }

    // الانفجارات التفاعلية متعددة الطبقات
    this.explosionGraphics.clear();
    for (const ex of engine.explosions) {
      const p = ex.progress;
      const rShock = ex.maxRadius * (0.25 + p * 1.05);
      const shockAlpha = Math.max(0, 1 - p) * 0.9;
      this.explosionGraphics.circle(ex.x, ex.y, rShock).stroke({ width: 3.5 * (1 - p * 0.6), color: 0xfef08a, alpha: shockAlpha });

      const rFire = ex.maxRadius * 0.68 * Math.sin(Math.min(1, p * 1.25) * Math.PI);
      if (rFire > 2) {
        this.explosionGraphics.circle(ex.x, ex.y, rFire).fill({ color: 0xf97316, alpha: Math.max(0, 0.85 - p * 0.7) });
        this.explosionGraphics.circle(ex.x, ex.y, rFire * 0.55).fill({ color: 0xfef08a, alpha: Math.max(0, 0.95 - p * 1.1) });
      }

      // شظايا ودخان متصاعد
      const sparkCount = ex.kind === 'missile' ? 10 : 7;
      for (let i = 0; i < sparkCount; i++) {
        const ang = (i / sparkCount) * Math.PI * 2 + (ex.x % 3);
        const dist = ex.maxRadius * (0.2 + p * 0.95) * (0.7 + ((i * 17) % 5) * 0.1);
        const sx = ex.x + Math.cos(ang) * dist;
        const sy = ex.y + Math.sin(ang) * dist - p * 16;
        if (p < 0.75) {
          this.explosionGraphics.circle(sx, sy, 3.2 * (1 - p)).fill({ color: 0xfbbf24, alpha: 1 - p });
        }
        this.explosionGraphics
          .circle(sx * 0.25 + ex.x * 0.75 + Math.cos(ang) * dist * 0.45, ex.y + Math.sin(ang) * dist * 0.45 - p * 26, 8 + p * 12)
          .fill({ color: 0x334155, alpha: Math.max(0, (1 - p) * 0.52) });
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
    const calloutScale = Math.max(0.42, Math.min(1.15, 1 / Math.pow(Math.max(0.25, this.camZoom), 0.78)));
    for (const c of engine.callouts.values()) {
      const targetEnt = engine.entities.get(c.target);
      const targetAnchor = engine.map.anchors[c.target];
      const tx = targetEnt ? lerp(targetEnt.prevX, targetEnt.x, alpha) : targetAnchor?.x;
      const entOffset = Math.max(10, 26 * this.lastUnitFactor * (targetEnt?.scaleMul ?? 1)) + 14 * calloutScale;
      const ty = targetEnt
        ? lerp(targetEnt.prevY, targetEnt.y, alpha) - entOffset
        : targetAnchor
          ? targetAnchor.y - 28 * calloutScale
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
        const w = cv.label.width + 22;
        const h = 28;
        cv.bg
          .clear()
          .roundRect(-w / 2 + 1, -h / 2 + 2, w, h, 7)
          .fill({ color: 0x020617, alpha: 0.55 })
          .roundRect(-w / 2, -h / 2, w, h, 7)
          .fill({ color: 0x0f172a, alpha: 0.96 })
          .stroke({ width: 1.75, color: c.color });
      }
      cv.container.position.set(tx, ty);
      cv.container.scale.set(calloutScale);
    }

    // إضاءة محيطية ناعمة فوق المشهد
    this.ambientGraphics.clear();
    const cx = this.mapWidth / 2;
    const cy = this.mapHeight / 2;
    const ambR = Math.max(this.mapWidth, this.mapHeight) * 0.62;
    this.ambientGraphics
      .circle(cx, cy, ambR)
      .fill({ color: 0x38bdf8, alpha: 0.028 })
      .rect(0, 0, this.mapWidth, this.mapHeight)
      .stroke({ width: 3, color: 0x1e293b, alpha: 0.7 });

    // رسم توضيحي معماري مبسط عند طلبه
    this.diagramLayer.visible = this.showArchitectureDiagram;
    if (this.showArchitectureDiagram && !this.diagramBuilt) {
      this.buildArchitectureDiagram();
    }
  }

  private drawCornerBrackets(g: Graphics, hw: number, hh: number, arm: number, color: number, width: number, alpha: number): void {
    const a = Math.min(arm, hw * 0.65, hh * 0.65);
    g.moveTo(-hw, -hh + a).lineTo(-hw, -hh).lineTo(-hw + a, -hh)
      .moveTo(hw - a, -hh).lineTo(hw, -hh).lineTo(hw, -hh + a)
      .moveTo(hw, hh - a).lineTo(hw, hh).lineTo(hw - a, hh)
      .moveTo(-hw + a, hh).lineTo(-hw, hh).lineTo(-hw, hh - a)
      .stroke({ width, color, alpha });
  }

  private buildArchitectureDiagram(): void {
    this.diagramBuilt = true;
    this.diagramLayer.removeChildren();

    const panelW = 540;
    const panelH = 148;
    const margin = 16;
    const panel = new Container();
    panel.position.set(margin, margin);

    const bg = new Graphics()
      .roundRect(0, 0, panelW, panelH, 10)
      .fill({ color: 0x090f1a, alpha: 0.92 })
      .stroke({ width: 1.5, color: 0x334155, alpha: 0.95 });
    panel.addChild(bg);

    const title = new Text({
      text: 'Architecture Data Flow (engine.ts → studioRenderer.ts → UI)',
      style: {
        fontFamily: 'Inter, system-ui, sans-serif',
        fontSize: 12,
        fontWeight: '700',
        fill: 0xf8fafc
      }
    });
    title.position.set(14, 10);
    panel.addChild(title);

    const nodes = [
      { title: 'Engine (engine.ts)', sub: 'State, A* Nav,\nPhysics, Timeline', x: 14, color: 0x38bdf8 },
      { title: 'Renderer (studioRenderer)', sub: 'Lerp/Easing, Glow,\nShadows, PixiJS', x: 190, color: 0x4ade80 },
      { title: 'UI (App.tsx)', sub: 'Controls, Inspector,\nScenario Timeline', x: 366, color: 0xfbbf24 }
    ];

    for (const n of nodes) {
      const box = new Graphics()
        .roundRect(n.x, 38, 158, 92, 8)
        .fill({ color: 0x0f172a, alpha: 0.95 })
        .stroke({ width: 1.5, color: n.color, alpha: 0.85 });
      panel.addChild(box);

      const nTitle = new Text({
        text: n.title,
        style: {
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: 11,
          fontWeight: '700',
          fill: n.color
        }
      });
      nTitle.position.set(n.x + 10, 48);
      panel.addChild(nTitle);

      const nSub = new Text({
        text: n.sub,
        style: {
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: 10.5,
          fill: 0xcbd5e1,
          lineHeight: 15
        }
      });
      nSub.position.set(n.x + 10, 72);
      panel.addChild(nSub);
    }

    const arrows = new Graphics()
      .moveTo(174, 84).lineTo(188, 84)
      .moveTo(183, 79).lineTo(188, 84).lineTo(183, 89)
      .moveTo(350, 84).lineTo(364, 84)
      .moveTo(359, 79).lineTo(364, 84).lineTo(359, 89)
      .stroke({ width: 2, color: 0x94a3b8, alpha: 0.9 });
    panel.addChild(arrows);

    this.diagramLayer.addChild(panel);
  }

  private createEntityView(ent: EntityState): EntityView {
    const container = new Container();
    const tex = this.actorTextures.get(ent.actorId) ?? Texture.EMPTY;
    const ratio = ent.scale / Math.max(1, tex.width, tex.height);
    const drawW = Math.max(ent.radius * 1.4, tex.width * ratio);
    const drawH = Math.max(ent.radius * 1.0, tex.height * ratio);

    const shadowY = ent.kind === 'air' ? 8 : ent.scale * 0.16;
    const shadow = new Graphics()
      .ellipse(0, shadowY, drawW * 0.52, drawH * 0.4)
      .fill({ color: 0x020617, alpha: 0.18 })
      .ellipse(0, shadowY, drawW * 0.38, drawH * 0.28)
      .fill({ color: 0x000000, alpha: ent.kind === 'air' ? 0.34 : 0.28 });

    const glow = new Graphics();

    const isElongated = drawW > drawH * 1.35;
    const hw = Math.max(12, drawW * 0.52);
    const hh = Math.max(10, drawH * 0.54);
    const factionHalo = new Graphics();
    const ring = new Graphics();
    const fCol = FACTION_COLOR[ent.faction] ?? 0xcbd5e1;
    this.drawCornerBrackets(factionHalo, hw, hh, 5.5, fCol, 1.5, 0.58);
    this.drawCornerBrackets(ring, hw + 4, hh + 4, 8, 0x4ade80, 2.2, 0.95);
    ring.visible = false;
    const buildArc = new Graphics();

    const sprite = new Sprite(tex);
    sprite.anchor.set(0.5);
    sprite.scale.set(ratio);

    let rotor: Graphics | undefined;
    if (ent.actorId === 'attack_heli') {
      rotor = new Graphics()
        .poly([-20, -1.4, -4, -0.8, -4, 0.8, -20, 1.4])
        .fill({ color: 0x94a3b8, alpha: 0.78 })
        .poly([4, -0.8, 20, -1.4, 20, 1.4, 4, 0.8])
        .fill({ color: 0x94a3b8, alpha: 0.78 })
        .poly([-1.4, -20, 1.4, -20, 0.8, -4, -0.8, -4])
        .fill({ color: 0x94a3b8, alpha: 0.78 })
        .poly([-0.8, 4, 0.8, 4, 1.4, 20, -1.4, 20])
        .fill({ color: 0x94a3b8, alpha: 0.78 })
        .circle(-19.5, 0, 1.2).fill({ color: 0xfacc15, alpha: 0.85 })
        .circle(19.5, 0, 1.2).fill({ color: 0xfacc15, alpha: 0.85 })
        .circle(0, -19.5, 1.2).fill({ color: 0xfacc15, alpha: 0.85 })
        .circle(0, 19.5, 1.2).fill({ color: 0xfacc15, alpha: 0.85 })
        .circle(0, 0, 2.8)
        .fill({ color: 0x475569 })
        .stroke({ width: 1, color: 0xe2e8f0, alpha: 0.85 });
      rotor.position.set(1, 0);
    }

    if (rotor) {
      container.addChild(shadow, glow, factionHalo, ring, sprite, rotor, buildArc);
    } else {
      container.addChild(shadow, glow, factionHalo, ring, sprite, buildArc);
    }
    return {
      container,
      sprite,
      baseSpriteScale: ratio,
      isElongated,
      shadow,
      glow,
      ring,
      factionHalo,
      buildArc,
      rotor,
      visX: ent.x,
      visY: ent.y,
      visAngle: ent.angle,
      initialized: false
    };
  }

  destroy(): void {
    this.destroyed = true;
    this.cleanupListeners.forEach((fn) => fn());
    this.cleanupListeners = [];
    for (const tex of this.actorTextures.values()) {
      if (tex !== Texture.EMPTY) tex.destroy(true);
    }
    this.actorTextures.clear();
    try {
      this.app.destroy(true, { children: true });
    } catch {
      // Ignore destroy errors if init hadn't finished
    }
  }
}

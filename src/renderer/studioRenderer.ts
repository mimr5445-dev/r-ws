import { Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { StudioEngine, normalizeAngleDiff } from '../core/engine';
import { EntityState, Faction, Point } from '../core/types';

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

interface EntityView {
  container: Container;
  sprite: Sprite;
  shadow: Graphics;
  factionRing: Graphics;
  ring: Graphics;
  buildArc: Graphics;
  wakeGraphics: Graphics;
}

export class StudioRenderer {
  public app = new Application();
  private world = new Container();
  private mapLayer = new Container();
  private zoneGraphics = new Graphics();
  private pathGraphics = new Graphics();
  private arrowGraphics = new Graphics();
  private anchorLayer = new Container();
  private entityLayer = new Container();

  private actorTextures = new Map<string, Texture>();
  private entityViews = new Map<string, EntityView>();

  private camX = 600;
  private camY = 400;
  private camZoom = 1;
  private lastCamSeq = -1;
  private dragging = false;
  private dragMoved = false;
  private lastPointer: Point = { x: 0, y: 0 };
  private mapWidth = 1200;
  private mapHeight = 800;

  public selectedEntityId: string | null = null;
  public hideUIHelpers = false;
  public showAnchors = true;
  public onMapClick?: (worldPt: Point, clickedEntityId: string | null) => void;
  public onSelectionChange?: (entityId: string | null) => void;

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
      this.zoneGraphics,
      this.pathGraphics,
      this.arrowGraphics,
      this.anchorLayer,
      this.entityLayer
    );
    this.app.stage.addChild(this.world);
    this.setupPointerEvents();
  }

  private setupPointerEvents(): void {
    const canvas = this.app.canvas;

    const onPointerDown = (e: PointerEvent) => {
      this.dragging = true;
      this.dragMoved = false;
      this.lastPointer = { x: e.clientX, y: e.clientY };
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastPointer.x;
      const dy = e.clientY - this.lastPointer.y;
      if (Math.hypot(dx, dy) > 4) {
        this.dragMoved = true;
        // Stop auto camera glide once user pans manually
        this.lastCamSeq = Number.MAX_SAFE_INTEGER;
      }
      this.camX -= dx / this.camZoom;
      this.camY -= dy / this.camZoom;
      this.lastPointer = { x: e.clientX, y: e.clientY };
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!this.dragging) return;
      this.dragging = false;
      if (!this.dragMoved && e.target === canvas) {
        const rect = canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const wx = (sx - this.app.screen.width / 2) / this.camZoom + this.camX;
        const wy = (sy - this.app.screen.height / 2) / this.camZoom + this.camY;
        const hit = this.pickEntity(wx, wy);
        this.onMapClick?.({ x: wx, y: wy }, hit);
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      this.lastCamSeq = Number.MAX_SAFE_INTEGER;
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      this.camZoom = Math.max(0.4, Math.min(3.5, this.camZoom * factor));
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    this.cleanupListeners.push(() => {
      canvas.removeEventListener('pointerdown', onPointerDown);
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

  zoomBy(factor: number): void {
    this.lastCamSeq = Number.MAX_SAFE_INTEGER;
    this.camZoom = Math.max(0.4, Math.min(3.5, this.camZoom * factor));
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

  async loadEngineAssets(engine: StudioEngine): Promise<void> {
    this.mapLayer.removeChildren();
    this.anchorLayer.removeChildren();
    this.entityLayer.removeChildren();
    this.entityViews.clear();
    this.selectedEntityId = null;
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

    for (const [id, pt] of Object.entries(engine.map.anchors)) {
      const dot = new Graphics()
        .circle(0, 0, 5)
        .fill({ color: 0xfef08a, alpha: 0.92 })
        .stroke({ width: 2, color: 0x0f172a });
      dot.position.set(pt.x, pt.y);
      const label = new Text({
        text: pt.label ?? id,
        style: {
          fontFamily: 'IBM Plex Sans Arabic, system-ui, sans-serif',
          fontSize: 12,
          fontWeight: '600',
          fill: 0xe2e8f0,
          stroke: { color: 0x090f1a, width: 3.5 }
        }
      });
      label.anchor.set(0.5, 1);
      label.position.set(pt.x, pt.y - 9);
      this.anchorLayer.addChild(dot, label);
    }

    for (const actor of Object.values(engine.actors)) {
      if (!this.actorTextures.has(actor.id)) {
        this.actorTextures.set(actor.id, await loadSvgOrUrlTexture(actor.svg, 64, 64));
      }
    }

    this.camX = engine.map.width / 2;
    this.camY = engine.map.height / 2;
    const sw = Math.max(1, this.app.screen.width);
    const sh = Math.max(1, this.app.screen.height);
    this.camZoom = Math.min(sw / engine.map.width, sh / engine.map.height) * 0.94;
    this.lastCamSeq = -1;
  }

  render(engine: StudioEngine, alpha: number, timeSec: number, frameDt = 0.016): void {
    if (this.destroyed) return;
    this.anchorLayer.visible = !this.hideUIHelpers && this.showAnchors;

    // حركة الكاميرا السلسة نحو الهدف مع إبقاء الخريطة مؤطّرة جيدًا
    if (engine.cameraTarget && engine.cameraTarget.seq !== this.lastCamSeq && this.lastCamSeq !== Number.MAX_SAFE_INTEGER) {
      const targetZoom = engine.cameraTarget.zoom;
      const halfW = this.app.screen.width / (2 * targetZoom);
      const halfH = this.app.screen.height / (2 * targetZoom);
      const goalX =
        halfW * 2 >= this.mapWidth
          ? this.mapWidth / 2
          : Math.max(halfW, Math.min(this.mapWidth - halfW, engine.cameraTarget.x));
      const goalY =
        halfH * 2 >= this.mapHeight
          ? this.mapHeight / 2
          : Math.max(halfH, Math.min(this.mapHeight - halfH, engine.cameraTarget.y));

      const speedFactor = 1 - Math.exp((-frameDt * 3.6) / Math.max(0.25, engine.cameraTarget.durationSec));
      this.camX = lerp(this.camX, goalX, speedFactor);
      this.camY = lerp(this.camY, goalY, speedFactor);
      this.camZoom = lerp(this.camZoom, targetZoom, speedFactor);
      if (
        Math.hypot(this.camX - goalX, this.camY - goalY) < 0.8 &&
        Math.abs(this.camZoom - targetZoom) < 0.005
      ) {
        this.lastCamSeq = engine.cameraTarget.seq;
      }
    }

    this.world.position.set(this.app.screen.width / 2, this.app.screen.height / 2);
    this.world.scale.set(this.camZoom);
    this.world.pivot.set(this.camX, this.camY);

    // رسم المناطق الملونة
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

    // رسم الأسهم المنحنية المتنامية
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

    // مزامنة الكيانات مع تحريك إجرائي ناعم
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

      // اهتزاز مشي لطيف للأشخاص + دوران سلس للآليات والسفن + أثر حركة
      if (ent.kind === 'person') {
        const bob = ent.isMoving ? Math.abs(Math.sin(timeSec * 12)) * 3 : 0;
        view.sprite.y = -bob;
        view.sprite.rotation = ent.isMoving ? Math.sin(timeSec * 12) * 0.08 : 0;
      } else if (ent.kind === 'vehicle' || ent.kind === 'ship') {
        view.sprite.rotation = lerpAngle(ent.prevAngle, ent.angle, alpha);
      }

      // أثر الحركة للسفن والآليات
      view.wakeGraphics.clear();
      if (ent.isMoving && (ent.kind === 'ship' || ent.kind === 'vehicle')) {
        const ang = view.sprite.rotation;
        const wakeColor = ent.kind === 'ship' ? 0xbae6fd : 0xd6d3d1;
        const pulse = (timeSec * 2.5) % 1;
        const backDist = ent.radius * (0.9 + pulse * 0.6);
        const bx = -Math.cos(ang) * backDist;
        const by = -Math.sin(ang) * backDist;
        const perpX = -Math.sin(ang) * 7;
        const perpY = Math.cos(ang) * 7;
        view.wakeGraphics
          .moveTo(bx - perpX, by - perpY)
          .lineTo(bx + Math.cos(ang) * 6, by + Math.sin(ang) * 6)
          .lineTo(bx + perpX, by + perpY)
          .stroke({ width: 2, color: wakeColor, alpha: (1 - pulse) * 0.55 });
      }

      // مظهر البناء التدريجي
      view.sprite.alpha = ent.buildProgress < 1 ? 0.35 + ent.buildProgress * 0.65 : 1;
      view.buildArc.clear();
      if (ent.buildProgress < 1) {
        view.buildArc
          .arc(0, 0, ent.radius + 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ent.buildProgress)
          .stroke({ width: 3, color: 0x38bdf8 });
      }
      view.ring.visible = !this.hideUIHelpers && this.selectedEntityId === ent.id;
    }
  }

  private createEntityView(ent: EntityState): EntityView {
    const container = new Container();
    const shadow = new Graphics()
      .ellipse(0, ent.scale * 0.32, ent.radius * 0.9, ent.radius * 0.4)
      .fill({ color: 0x000000, alpha: 0.38 });
    const factionRing = new Graphics()
      .circle(0, 0, ent.radius + 2)
      .stroke({ width: 1.5, color: FACTION_COLOR[ent.faction], alpha: 0.55 });
    const ring = new Graphics().circle(0, 0, ent.radius + 7).stroke({ width: 2.5, color: 0x22c55e });
    ring.visible = false;
    const buildArc = new Graphics();
    const wakeGraphics = new Graphics();

    const tex = this.actorTextures.get(ent.actorId) ?? Texture.EMPTY;
    const sprite = new Sprite(tex);
    sprite.anchor.set(0.5);
    const ratio = ent.scale / Math.max(1, tex.height);
    sprite.scale.set(ratio);

    container.addChild(shadow, wakeGraphics, factionRing, ring, sprite, buildArc);
    return { container, sprite, shadow, factionRing, ring, buildArc, wakeGraphics };
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

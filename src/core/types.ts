export type Domain = 'land' | 'sea' | 'air';
export type Faction = 'blue' | 'red' | 'neutral';
export type SoundId = 'build_complete' | 'alert_ping' | 'move_order' | 'spawn_pop';

// خلايا شبكة الملاحة: 0 = يابسة، 1 = ماء، 2 = عائق صلب
export type NavCell = 0 | 1 | 2;

export interface Point {
  x: number;
  y: number;
}

export interface MapZoneDef {
  id: string;
  label: string;
  polygon: Point[];
}

export interface MapPack {
  id: string;
  title: string;
  kind: 'geopolitical' | 'tactical';
  width: number;
  height: number;
  cellSize: number;
  cols: number;
  rows: number;
  navGrid: NavCell[]; // cols * rows
  svgOrUrl: string;
  anchors: Record<string, Point & { label?: string }>;
  zones: Record<string, MapZoneDef>;
}

export interface ActorTemplate {
  domain: Domain;
  kind: 'person' | 'vehicle' | 'ship' | 'building';
  speed: number; // world units / second
  turnRate: number; // rad / second
  scale: number; // target height in world units
  radius: number;
}

export interface ActorPack extends ActorTemplate {
  id: string;
  label: string;
  extends?: string;
  svg: string;
}

export interface ScenarioStep {
  id?: string;
  at?: string;
  after?: string; // "<entityId>.arrived"
  camera?: { focus: string; zoom?: number; duration?: string };
  caption?: { text: string };
  sound?: SoundId;
  spawn?: Array<{ id: string; actor: string; at: string; faction?: Faction }>;
  move?: { entity: string; to: string };
  construct?: { id?: string; actor: string; at: string; faction?: Faction; duration?: string };
  draw_arrow?: { id: string; from: string; to: string; color?: string; dashed?: boolean; duration?: string };
  zone?: { id: string; color: string; opacity?: number; duration?: string };
}

export interface ScenarioFile {
  meta: { title: string; map: string; duration_hint?: string };
  timeline: ScenarioStep[];
}

export interface EntityState {
  id: string;
  actorId: string;
  kind: ActorTemplate['kind'];
  domain: Domain;
  faction: Faction;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  angle: number;
  prevAngle: number;
  path: Point[];
  speed: number;
  turnRate: number;
  scale: number;
  radius: number;
  buildProgress: number; // 0..1 (1 = مكتمل)
  buildRate: number;
  isMoving: boolean;
  arrivedTick: number | null;
}

export interface ArrowState {
  id: string;
  from: Point;
  to: Point;
  color: string;
  dashed: boolean;
  progress: number;
  rate: number;
}

export interface ZoneVisualState {
  id: string;
  color: string;
  targetOpacity: number;
  opacity: number;
  rate: number;
}

export interface CameraTarget {
  x: number;
  y: number;
  zoom: number;
  durationSec: number;
  seq: number;
}

export type Order =
  | { type: 'spawn'; id: string; actorId: string; at: Point; faction: Faction }
  | { type: 'move'; entityId: string; to: Point }
  | { type: 'construct'; id: string; actorId: string; at: Point; faction: Faction; durationSec: number };

export interface ValidationIssue {
  stepIndex: number;
  field: string;
  message: string;
}

import * as yaml from 'js-yaml';
import { Faction, Point, ScenarioFile, ScenarioStep } from './types';

export class ActionRecorder {
  public isRecording = false;
  public mapId = '';
  public steps: ScenarioStep[] = [];
  private startPerfMs = 0;

  start(mapId: string, initialCamera: { x: number; y: number; zoom: number }): void {
    this.isRecording = true;
    this.mapId = mapId;
    this.steps = [
      {
        at: '0.0s',
        camera: {
          focus: { x: Math.round(initialCamera.x), y: Math.round(initialCamera.y) },
          zoom: Number(initialCamera.zoom.toFixed(2)),
          duration: '0.8s'
        }
      }
    ];
    this.startPerfMs = performance.now();
  }

  stop(): void {
    this.isRecording = false;
  }

  elapsedSec(): number {
    if (!this.isRecording) return 0;
    return (performance.now() - this.startPerfMs) / 1000;
  }

  private atLabel(): string {
    return `${this.elapsedSec().toFixed(1)}s`;
  }

  private roundPt(pt: Point): Point {
    return { x: Math.round(pt.x), y: Math.round(pt.y) };
  }

  recordSpawn(id: string, actor: string, pt: Point, faction: Faction = 'blue'): void {
    if (!this.isRecording) return;
    this.steps.push({
      at: this.atLabel(),
      spawn: [{ id, actor, at: this.roundPt(pt), faction }]
    });
  }

  recordMove(entityId: string, pt: Point): void {
    if (!this.isRecording) return;
    this.steps.push({
      at: this.atLabel(),
      move: { entity: entityId, to: this.roundPt(pt) }
    });
  }

  recordConstruct(id: string, actor: string, pt: Point, faction: Faction = 'blue', durationSec = 1.8): void {
    if (!this.isRecording) return;
    this.steps.push({
      at: this.atLabel(),
      construct: { id, actor, at: this.roundPt(pt), faction, duration: `${durationSec}s` }
    });
  }

  recordRemove(entityId: string): void {
    if (!this.isRecording) return;
    this.steps.push({ at: this.atLabel(), remove: { entity: entityId } });
  }

  recordZone(zoneId: string, color: string, opacity = 0.35): void {
    if (!this.isRecording) return;
    this.steps.push({
      at: this.atLabel(),
      zone: { id: zoneId, color, opacity, duration: '1s' }
    });
  }

  recordArrow(id: string, from: Point, to: Point, color = '#f59e0b', dashed = true): void {
    if (!this.isRecording) return;
    this.steps.push({
      at: this.atLabel(),
      draw_arrow: { id, from: this.roundPt(from), to: this.roundPt(to), color, dashed, duration: '1.2s' }
    });
  }

  recordPulse(pt: Point, color = '#ef4444'): void {
    if (!this.isRecording) return;
    this.steps.push({ at: this.atLabel(), pulse: { at: this.roundPt(pt), color, radius: 70 } });
  }

  recordCaption(text: string): void {
    if (!this.isRecording) return;
    this.steps.push({ at: this.atLabel(), caption: { text } });
  }

  recordCamera(x: number, y: number, zoom: number): void {
    if (!this.isRecording) return;
    this.steps.push({
      at: this.atLabel(),
      camera: {
        focus: { x: Math.round(x), y: Math.round(y) },
        zoom: Number(zoom.toFixed(2)),
        duration: '1s'
      }
    });
  }

  toScenarioFile(title: string): ScenarioFile {
    return {
      meta: { title, map: this.mapId },
      timeline: this.steps
    };
  }

  toYaml(title: string): string {
    return yaml.dump(this.toScenarioFile(title), { lineWidth: 120, noRefs: true });
  }
}

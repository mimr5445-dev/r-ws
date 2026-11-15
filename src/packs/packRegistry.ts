import { ActorPack, ActorTemplate, MapPack, PackBundle } from '../core/types';
import { buildWorldMapPack } from '../maps/worldGeoEngine';
import { DEMO_ACTORS, DEMO_MAPS, TEMPLATES } from './demoPacks';

export const ACTOR_TEMPLATES: Record<string, ActorTemplate> = TEMPLATES;

const STORAGE_KEY = 'rw_studio_custom_packs_v1';

export class PackRegistry {
  public maps: Record<string, MapPack> = {};
  public actors: Record<string, ActorPack> = {};
  private customBundle: PackBundle = { maps: [], actors: [] };

  constructor(private useStorage = true) {
    for (const [k, m] of Object.entries(DEMO_MAPS)) {
      this.maps[k] = {
        ...m,
        navGrid: [...m.navGrid],
        anchors: { ...m.anchors },
        zones: { ...m.zones }
      };
    }
    if (typeof document !== 'undefined') {
      const worldMap = buildWorldMapPack();
      this.maps[worldMap.id] = worldMap;
    }
    for (const [k, a] of Object.entries(DEMO_ACTORS)) {
      this.actors[k] = { ...a };
    }
    if (this.useStorage) {
      this.loadFromStorage();
    }
  }

  private loadFromStorage(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as PackBundle;
      this.customBundle = { maps: parsed.maps ?? [], actors: parsed.actors ?? [] };
      this.applyBundle(this.customBundle);
    } catch {
      // تجاهل البيانات التالفة
    }
  }

  private saveToStorage(): void {
    try {
      if (!this.useStorage || typeof localStorage === 'undefined') return;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.customBundle));
    } catch {
      // Ignore quota errors
    }
  }

  applyBundle(bundle: PackBundle): void {
    for (const m of bundle.maps ?? []) {
      this.maps[m.id] = m;
    }
    for (const a of bundle.actors ?? []) {
      const tpl = a.extends ? ACTOR_TEMPLATES[a.extends] : undefined;
      this.actors[a.id] = { ...(tpl ?? ACTOR_TEMPLATES._person), ...a };
    }
  }

  saveCustomMap(map: MapPack): void {
    this.maps[map.id] = map;
    const { hitTest: _ht, ...serializable } = map;
    this.customBundle.maps = (this.customBundle.maps ?? []).filter((m) => m.id !== map.id);
    this.customBundle.maps.push(serializable);
    this.saveToStorage();
  }

  saveCustomActor(actor: Partial<ActorPack> & { id: string; label: string; svg: string }): ActorPack {
    const tpl = actor.extends ? ACTOR_TEMPLATES[actor.extends] : ACTOR_TEMPLATES._person;
    const resolved: ActorPack = { ...(tpl ?? ACTOR_TEMPLATES._person), ...actor };
    this.actors[resolved.id] = resolved;
    this.customBundle.actors = (this.customBundle.actors ?? []).filter((a) => a.id !== resolved.id);
    this.customBundle.actors.push(resolved);
    this.saveToStorage();
    return resolved;
  }

  importBundle(bundle: PackBundle): { mapsAdded: number; actorsAdded: number } {
    for (const m of bundle.maps ?? []) this.saveCustomMap(m);
    for (const a of bundle.actors ?? []) this.saveCustomActor(a);
    return { mapsAdded: bundle.maps?.length ?? 0, actorsAdded: bundle.actors?.length ?? 0 };
  }

  exportCurrentBundle(): PackBundle {
    const maps = Object.values(this.maps)
      .filter((m) => !m.geoLevel)
      .map(({ hitTest: _ht, regions: _regs, ...rest }) => rest);
    return {
      maps,
      actors: Object.values(this.actors)
    };
  }
}

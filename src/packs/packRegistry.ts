import { ActorPack, ActorTemplate, MapPack, PackBundle, SavedScenarioRecord } from '../core/types';
import { buildWorldMapPack } from '../maps/worldGeoEngine';
import { studioDb } from '../storage/studioDb';
import { DEMO_ACTORS, DEMO_MAPS, TEMPLATES } from './demoPacks';
import { validatePackBundle } from './packSchema';

const RETIRED_MAP_IDS = new Set(['geopolitics_strait', 'tactical_valley']);
const RETIRED_SCENARIO_IDS = new Set(['preset_air_sea', 'preset_world', 'preset_strait', 'preset_valley']);

export const ACTOR_TEMPLATES: Record<string, ActorTemplate> = TEMPLATES;

export class PackRegistry {
  public maps: Record<string, MapPack> = {};
  public actors: Record<string, ActorPack> = {};
  public scenarios: SavedScenarioRecord[] = [];

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
  }

  async init(presetScenarios: SavedScenarioRecord[]): Promise<void> {
    if (typeof document !== 'undefined' && !this.maps.world_live) {
      const worldMap = buildWorldMapPack();
      this.maps[worldMap.id] = worldMap;
    }

    if (!this.useStorage) {
      this.scenarios = [...presetScenarios];
      return;
    }

    const savedMaps = await studioDb.loadAllMaps();
    for (const m of savedMaps) {
      // تحديث خريطة العالم من النسخة الحية مع الاحتفاظ بالخرائط المخصصة والدول المحفوظة
      if (m.id !== 'world_live' && !RETIRED_MAP_IDS.has(m.id)) this.maps[m.id] = m;
    }

    const savedActors = await studioDb.loadAllActors();
    for (const a of savedActors) this.applyActor(a);

    for (const id of RETIRED_SCENARIO_IDS) {
      await studioDb.deleteScenario(id);
    }
    const savedScenarios = (await studioDb.loadAllScenarios()).filter((s) => !RETIRED_SCENARIO_IDS.has(s.id));
    const existingIds = new Set(savedScenarios.map((s) => s.id));
    for (const p of presetScenarios) {
      if (!existingIds.has(p.id)) {
        await studioDb.saveScenario(p);
        savedScenarios.push(p);
      }
    }
    this.scenarios = savedScenarios.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  private applyActor(a: ActorPack): void {
    const tpl = a.extends ? ACTOR_TEMPLATES[a.extends] : undefined;
    this.actors[a.id] = { ...(tpl ?? ACTOR_TEMPLATES._person), ...a };
  }

  async saveCustomMap(map: MapPack): Promise<void> {
    this.maps[map.id] = map;
    if (this.useStorage) {
      await studioDb.saveMap(map);
    }
  }

  async saveCustomActor(
    actor: Partial<ActorPack> & { id: string; label: string; svg: string }
  ): Promise<ActorPack> {
    const tpl = actor.extends ? ACTOR_TEMPLATES[actor.extends] : ACTOR_TEMPLATES._person;
    const resolved: ActorPack = { ...(tpl ?? ACTOR_TEMPLATES._person), ...actor };
    this.actors[resolved.id] = resolved;
    if (this.useStorage) {
      await studioDb.saveActor(resolved);
    }
    return resolved;
  }

  async saveScenarioRecord(rec: SavedScenarioRecord): Promise<void> {
    if (this.useStorage) {
      await studioDb.saveScenario(rec);
    }
    this.scenarios = [rec, ...this.scenarios.filter((s) => s.id !== rec.id)].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async deleteScenarioRecord(id: string): Promise<void> {
    if (this.useStorage) {
      await studioDb.deleteScenario(id);
    }
    this.scenarios = this.scenarios.filter((s) => s.id !== id);
  }

  async importBundle(bundle: PackBundle): Promise<{ mapsAdded: number; actorsAdded: number }> {
    const errors = validatePackBundle(bundle);
    if (errors.length > 0) throw new Error(errors.slice(0, 5).join(' | '));
    for (const m of bundle.maps ?? []) await this.saveCustomMap(m);
    for (const a of bundle.actors ?? []) await this.saveCustomActor(a);
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

import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as yaml from 'js-yaml';
import { Eye, EyeOff, Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import { buildAiScenarioPrompt, generateCatalogMarkdown } from './core/catalog';
import { DT, StudioEngine, TICK_RATE } from './core/engine';
import { isPointNearWalkable } from './core/pathfinding';
import { Faction, MapPack, NavCell, PackBundle, Point, ScenarioFile, ValidationIssue } from './core/types';
import { validateScenario } from './core/validator';
import { buildCountryProvincesMapPack } from './maps/worldGeoEngine';
import { PackRegistry } from './packs/packRegistry';
import { SoundSynth } from './renderer/soundSynth';
import { StudioRenderer } from './renderer/studioRenderer';
import { MapEditTool } from './components/PackBuilderPanel';
import { SpecModal } from './components/SpecModal';
import { PresetOption, StudioSidebar } from './components/StudioSidebar';
import straitYaml from './scenarios/strait_crisis.scenario.yaml?raw';
import valleyYaml from './scenarios/valley_advance.scenario.yaml?raw';
import worldYaml from './scenarios/world_demo.scenario.yaml?raw';

const SCENARIOS: Record<string, { label: string; yaml: string }> = {
  world: { label: 'خريطة العالم التفاعلية (دول + محافظات)', yaml: worldYaml },
  strait: { label: 'أزمة المضيق (خريطة سياسية)', yaml: straitYaml },
  valley: { label: 'العبور التكتيكي (خريطة ميدان)', yaml: valleyYaml }
};

const PRESET_OPTIONS: PresetOption[] = [
  { key: 'world', label: SCENARIOS.world.label },
  { key: 'strait', label: SCENARIOS.strait.label },
  { key: 'valley', label: SCENARIOS.valley.label }
];

function formatSimTime(sec: number): string {
  const mins = Math.floor(sec / 60);
  const rem = sec % 60;
  return `${String(mins).padStart(2, '0')}:${rem.toFixed(1).padStart(4, '0')}`;
}

async function copyTextSafely(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fallback below
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    return true;
  } catch {
    return false;
  }
}

export default function App() {
  const registryRef = useRef<PackRegistry | null>(null);
  if (!registryRef.current) {
    registryRef.current = new PackRegistry();
  }

  const stageHostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<StudioRenderer | null>(null);
  const engineRef = useRef<StudioEngine | null>(null);
  const soundRef = useRef<SoundSynth | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  // Refs synced for 60fps loop
  const playingRef = useRef(true);
  const speedRef = useRef(1);
  const activeToolRef = useRef<string>('select');
  const sandboxFactionRef = useRef<Faction>('blue');
  const sandboxCounterRef = useRef(1);
  const mapToolRef = useRef<MapEditTool>('anchor');
  const pointNameRef = useRef<string>('');

  const toastTimerRef = useRef<number | null>(null);

  const [packVersion, setPackVersion] = useState(0);
  const [activeTab, setActiveTab] = useState<'play' | 'pack'>('play');
  const [selectedPreset, setSelectedPreset] = useState('world');
  const [yamlText, setYamlText] = useState(SCENARIOS.world.yaml);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [muted, setMuted] = useState(false);
  const [recording, setRecording] = useState(false);
  const [activeTool, setActiveTool] = useState<string>('select');
  const [sandboxFaction, setSandboxFaction] = useState<Faction>('blue');
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [aiTopic, setAiTopic] = useState('');
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [yamlSyntaxError, setYamlSyntaxError] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [showAnchors, setShowAnchors] = useState(true);
  const [specOpen, setSpecOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [activeMap, setActiveMap] = useState<MapPack>(
    registryRef.current.maps.world_live ?? registryRef.current.maps.geopolitics_strait
  );
  const [hoveredRegionId, setHoveredRegionId] = useState<string | null>(null);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [geoLoadingMsg, setGeoLoadingMsg] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Pack builder state
  const [newMapId, setNewMapId] = useState('');
  const [mapTool, setMapTool] = useState<MapEditTool>('anchor');
  const [pointName, setPointName] = useState('');
  const [draftZoneCount, setDraftZoneCount] = useState(0);
  const [newActorId, setNewActorId] = useState('');
  const [newActorLabel, setNewActorLabel] = useState('');
  const [newActorTpl, setNewActorTpl] = useState('_vehicle');
  const [pendingActorDataUrl, setPendingActorDataUrl] = useState('');
  const [packNotice, setPackNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Throttled HUD & scrubber readouts
  const [hudState, setHudState] = useState({
    simTimeSec: 0,
    tick: 0,
    maxTicks: 540,
    caption: '',
    entityCount: 0,
    executedSteps: 0,
    totalSteps: 0
  });

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);

  useEffect(() => {
    sandboxFactionRef.current = sandboxFaction;
  }, [sandboxFaction]);

  useEffect(() => {
    mapToolRef.current = mapTool;
    if (rendererRef.current) {
      rendererRef.current.editorOverlay.showNavGrid = mapTool.startsWith('paint_');
      rendererRef.current.editorOverlay.paintActive = mapTool.startsWith('paint_');
    }
  }, [mapTool]);

  useEffect(() => {
    pointNameRef.current = pointName;
  }, [pointName]);

  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.editorOverlay.enabled = activeTab === 'pack';
      rendererRef.current.editorOverlay.showNavGrid = activeTab === 'pack' && mapTool.startsWith('paint_');
      rendererRef.current.editorOverlay.paintActive = activeTab === 'pack' && mapTool.startsWith('paint_');
      if (engineRef.current) {
        rendererRef.current.refreshAnchors(engineRef.current.map);
      }
    }
  }, [activeTab, mapTool]);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToastMsg(null);
      toastTimerRef.current = null;
    }, 3000);
  }, []);

  const syncHudFromEngine = useCallback((eng: StudioEngine) => {
    const maxTicks = Math.max(60, Math.ceil(eng.estimateDurationSec() * TICK_RATE));
    setHudState({
      simTimeSec: eng.tick * DT,
      tick: eng.tick,
      maxTicks,
      caption: eng.caption,
      entityCount: eng.entities.size,
      executedSteps: eng.executedStepCount,
      totalSteps: eng.totalStepCount
    });
  }, []);

  const loadScenario = useCallback(
    async (rawYaml: string, noticeText: string | null = null) => {
      const reg = registryRef.current!;
      setIssues([]);
      setYamlSyntaxError(null);
      setStatusNotice(null);

      try {
        const parsed = yaml.load(rawYaml) as ScenarioFile;
        const map = reg.maps[parsed?.meta?.map];
        const foundIssues = validateScenario(parsed, map, reg.actors);
        if (foundIssues.length > 0) {
          setIssues(foundIssues);
          return;
        }

        const engine = new StudioEngine(map, reg.actors, parsed);
        if (soundRef.current) {
          engine.onSound((id) => soundRef.current?.play(id));
        }
        engine.onMoveBlocked((ent) => {
          showToast(
            ent.domain === 'land'
              ? '⚠️ لا يوجد مسار بري متصل — الدبابات والمشاة لا تعبر البحر!'
              : '⚠️ لا يوجد مسار بحري متصل — السفن لا تعبر اليابسة!'
          );
        });
        engineRef.current = engine;
        setActiveMap(map);
        setSelectedEntityId(null);
        setHoveredRegionId(null);
        setSelectedRegionId(null);

        if (rendererRef.current) {
          await rendererRef.current.loadEngineAssets(engine);
        }

        syncHudFromEngine(engine);
        if (noticeText) {
          setStatusNotice(noticeText);
        }
      } catch (err) {
        setYamlSyntaxError((err as Error).message);
      }
    },
    [showToast, syncHudFromEngine]
  );

  const enterCountryProvinces = useCallback(
    async (regionId: string) => {
      const eng = engineRef.current;
      const renderer = rendererRef.current;
      const regMap = eng?.map.regions?.[regionId];
      if (!eng || !renderer || !regMap?.iso3) return;

      const title = regMap.nameAr ? `${regMap.nameAr} (${regMap.name})` : regMap.name;
      setGeoLoadingMsg(`⏳ جاري تجهيز محافظات ${title}...`);
      renderer.focusRegion(eng, regionId);

      try {
        const countryMap = await buildCountryProvincesMapPack(regMap.iso3, title);
        registryRef.current!.maps[countryMap.id] = countryMap;
        setPackVersion((v) => v + 1);
        const firstAnchor = Object.keys(countryMap.anchors)[0];
        const starterYaml = `meta:\n  title: "${countryMap.title}"\n  map: ${countryMap.id}\ntimeline:\n  - at: 0s\n    caption: { text: "خريطة ${title} جاهزة — اختر وحدة وحرّكها بين المحافظات أو انسخ Prompt للـ AI" }${
          firstAnchor ? `\n    pulse: { at: ${firstAnchor}, color: "#38bdf8", radius: 65 }` : ''
        }\n`;
        setYamlText(starterYaml);
        setPlaying(true);
        await loadScenario(starterYaml, null);
      } catch (err) {
        showToast((err as Error).message);
      } finally {
        setGeoLoadingMsg(null);
      }
    },
    [loadScenario, showToast]
  );

  // Initialize PixiJS StudioRenderer + 30 TPS loop once
  useEffect(() => {
    const host = stageHostRef.current;
    if (!host) return;

    let cancelled = false;
    let rafId = 0;

    const sound = new SoundSynth();
    soundRef.current = sound;

    const renderer = new StudioRenderer();
    rendererRef.current = renderer;

    renderer.onSelectionChange = (id) => setSelectedEntityId(id);
    renderer.onRegionHover = (id) => setHoveredRegionId(id);
    renderer.onRegionDoubleClick = (id) => {
      if (engineRef.current?.map.geoLevel === 'world') {
        void enterCountryProvinces(id);
      }
    };

    const paintNavCell = (pt: Point, cellVal: NavCell) => {
      const eng = engineRef.current;
      if (!eng) return;
      const gx = Math.floor(pt.x / eng.map.cellSize);
      const gy = Math.floor(pt.y / eng.map.cellSize);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = gx + dx;
          const ny = gy + dy;
          if (nx >= 0 && ny >= 0 && nx < eng.map.cols && ny < eng.map.rows) {
            eng.map.navGrid[ny * eng.map.cols + nx] = cellVal;
          }
        }
      }
    };

    renderer.onMapPaint = (pt: Point) => {
      const tool = mapToolRef.current;
      if (tool === 'paint_land') paintNavCell(pt, 0);
      else if (tool === 'paint_sea') paintNavCell(pt, 1);
      else if (tool === 'paint_block') paintNavCell(pt, 2);
    };

    renderer.onMapClick = (pt: Point, hitId: string | null) => {
      const eng = engineRef.current;
      const reg = registryRef.current;
      if (!eng || !reg) return;

      if (renderer.editorOverlay.enabled) {
        const mTool = mapToolRef.current;
        if (mTool === 'anchor') {
          const fallbackName = `pt_${Object.keys(eng.map.anchors).length + 1}`;
          const rawName = pointNameRef.current.trim() || fallbackName;
          eng.map.anchors[rawName] = { x: Math.round(pt.x), y: Math.round(pt.y), label: rawName };
          renderer.refreshAnchors(eng.map);
          setPackNotice({ kind: 'ok', text: `تمت إضافة المرسى: ${rawName}` });
          setPackVersion((v) => v + 1);
        } else if (mTool === 'zone') {
          renderer.editorOverlay.draftZonePoints.push({ x: Math.round(pt.x), y: Math.round(pt.y) });
          setDraftZoneCount(renderer.editorOverlay.draftZonePoints.length);
        } else {
          renderer.onMapPaint?.(pt);
        }
        return;
      }

      const tool = activeToolRef.current;
      if (tool === 'select') {
        if (hitId) {
          renderer.selectedEntityId = hitId;
          setSelectedEntityId(hitId);
        } else if (renderer.selectedEntityId) {
          eng.dispatchOrder({ type: 'move', entityId: renderer.selectedEntityId, to: pt });
          eng.flushOrders();
          syncHudFromEngine(eng);
        } else {
          const regionHit = eng.map.hitTest?.(pt) ?? null;
          renderer.selectedRegionId = regionHit;
          setSelectedRegionId(regionHit);
        }
      } else {
        const actor = reg.actors[tool];
        if (!actor) return;
        if (!isPointNearWalkable(eng.map, pt, actor.domain, 2)) {
          showToast(
            actor.domain === 'land'
              ? '⚠️ لا يمكن وضع أو بناء وحدة برية في وسط البحر!'
              : '⚠️ لا يمكن وضع وحدة بحرية فوق اليابسة!'
          );
          return;
        }
        const id = `sb_${sandboxCounterRef.current++}`;
        const faction = sandboxFactionRef.current;
        if (actor.kind === 'building') {
          eng.dispatchOrder({ type: 'construct', id, actorId: actor.id, at: pt, faction, durationSec: 1.8 });
        } else {
          eng.dispatchOrder({ type: 'spawn', id, actorId: actor.id, at: pt, faction });
          renderer.selectedEntityId = id;
          setSelectedEntityId(id);
          setActiveTool('select');
        }
        eng.flushOrders();
        syncHudFromEngine(eng);
      }
    };

    const boot = async () => {
      await renderer.init(host);
      if (cancelled) return;
      await loadScenario(SCENARIOS.world.yaml, null);

      let accumulator = 0;
      let lastTime = performance.now();
      let lastHudTenths = -1;
      let lastHudCaption = '';
      let lastHudEntities = -1;
      let lastHudSteps = -1;

      const loop = (now: number) => {
        if (cancelled) return;
        const frameDt = Math.min(0.1, (now - lastTime) / 1000);
        lastTime = now;

        const eng = engineRef.current;
        if (eng && playingRef.current) {
          accumulator += frameDt * speedRef.current;
          while (accumulator >= DT) {
            eng.step();
            accumulator -= DT;
          }
        }

        if (eng) {
          const alpha = playingRef.current ? accumulator / DT : 1;
          renderer.render(eng, alpha, now / 1000, frameDt, playingRef.current);

          const simSec = eng.tick * DT;
          const tenths = Math.floor(simSec * 10);
          const entCount = eng.entities.size;
          const execSteps = eng.executedStepCount;

          if (
            tenths !== lastHudTenths ||
            eng.caption !== lastHudCaption ||
            entCount !== lastHudEntities ||
            execSteps !== lastHudSteps
          ) {
            lastHudTenths = tenths;
            lastHudCaption = eng.caption;
            lastHudEntities = entCount;
            lastHudSteps = execSteps;
            const maxTicks = Math.max(60, Math.ceil(eng.estimateDurationSec() * TICK_RATE));
            setHudState({
              simTimeSec: simSec,
              tick: eng.tick,
              maxTicks,
              caption: eng.caption,
              entityCount: entCount,
              executedSteps: execSteps,
              totalSteps: eng.totalStepCount
            });
          }
        }

        rafId = requestAnimationFrame(loop);
      };

      rafId = requestAnimationFrame(loop);
    };

    boot();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      if (recorderRef.current && recorderRef.current.state === 'recording') {
        recorderRef.current.stop();
      }
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
      renderer.destroy();
    };
  }, [enterCountryProvinces, loadScenario, showToast, syncHudFromEngine]);

  const handleSelectPreset = async (key: string) => {
    setSelectedPreset(key);
    const nextYaml = SCENARIOS[key].yaml;
    setYamlText(nextYaml);
    setPlaying(true);
    await loadScenario(nextYaml, null);
  };

  const handleRestart = () => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.reset();
    if (rendererRef.current) {
      rendererRef.current.selectedEntityId = null;
      rendererRef.current.resumeCameraTracking();
      setSelectedEntityId(null);
    }
    syncHudFromEngine(eng);
  };

  const handleScrub = (targetTick: number) => {
    const eng = engineRef.current;
    if (!eng) return;
    setPlaying(false);
    eng.seekToTick(targetTick);
    rendererRef.current?.syncCameraImmediate(eng);
    syncHudFromEngine(eng);
  };

  const handleToggleMute = () => {
    const next = !muted;
    setMuted(next);
    if (soundRef.current) soundRef.current.muted = next;
  };

  const handleToggleAnchors = () => {
    const next = !showAnchors;
    setShowAnchors(next);
    if (rendererRef.current) rendererRef.current.showAnchors = next;
  };

  const handleUploadYamlFile = async (file: File) => {
    const text = await file.text();
    setYamlText(text);
    await loadScenario(text, 'تم استيراد السيناريو وتشغيله');
  };

  const handleUploadMapImage = async (file: File) => {
    const eng = engineRef.current;
    const renderer = rendererRef.current;
    if (!eng || !renderer) return;
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    eng.map.svgOrUrl = url;
    await renderer.loadEngineAssets(eng);
  };

  const handleImportPackFile = async (file: File) => {
    try {
      const text = await file.text();
      const bundle = yaml.load(text) as PackBundle;
      const reg = registryRef.current!;
      const res = reg.importBundle(bundle);
      if (engineRef.current && rendererRef.current) {
        engineRef.current.actors = reg.actors;
        await rendererRef.current.syncActorTextures(reg.actors);
      }
      setPackVersion((v) => v + 1);
      const msg = `تم استيراد ${res.mapsAdded} خريطة و ${res.actorsAdded} كيان`;
      setStatusNotice(msg);
      setPackNotice({ kind: 'ok', text: msg });
    } catch (err) {
      setPackNotice({ kind: 'err', text: `فشل استيراد الحزمة: ${(err as Error).message}` });
    }
  };

  const handleStageDrop = async (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    if (file.name.endsWith('.pack.yaml') || file.name.endsWith('.pack.yml')) {
      await handleImportPackFile(file);
    } else if (file.name.endsWith('.yaml') || file.name.endsWith('.yml')) {
      await handleUploadYamlFile(file);
    } else if (file.type.startsWith('image/')) {
      await handleUploadMapImage(file);
    }
  };

  // Pack builder handlers
  const handleSelectActiveMap = async (mapId: string) => {
    const reg = registryRef.current!;
    const map = reg.maps[mapId];
    if (!map) return;
    const blankEngine = new StudioEngine(map, reg.actors, {
      meta: { title: map.title, map: map.id },
      timeline: []
    });
    engineRef.current = blankEngine;
    setActiveMap(map);
    if (rendererRef.current) {
      rendererRef.current.editorOverlay.draftZonePoints = [];
      setDraftZoneCount(0);
      await rendererRef.current.loadEngineAssets(blankEngine);
    }
    syncHudFromEngine(blankEngine);
    setPackNotice({ kind: 'ok', text: `تم فتح الخريطة "${map.id}" للتحرير` });
  };

  const handleUploadNewMapImage = (file: File) => {
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      const reg = registryRef.current!;
      const newId = newMapId.trim() || `custom_map_${Date.now()}`;
      const cols = 60;
      const rows = 40;
      const cellSize = 20;
      const newMap: MapPack = {
        id: newId,
        title: newId,
        kind: 'geopolitical',
        width: cols * cellSize,
        height: rows * cellSize,
        cellSize,
        cols,
        rows,
        navGrid: new Array(cols * rows).fill(0),
        svgOrUrl: dataUrl,
        anchors: {},
        zones: {}
      };
      reg.saveCustomMap(newMap);
      setPackVersion((v) => v + 1);
      const blankEngine = new StudioEngine(newMap, reg.actors, {
        meta: { title: newId, map: newId },
        timeline: []
      });
      engineRef.current = blankEngine;
      setActiveMap(newMap);
      if (rendererRef.current) {
        rendererRef.current.editorOverlay.draftZonePoints = [];
        setDraftZoneCount(0);
        await rendererRef.current.loadEngineAssets(blankEngine);
      }
      syncHudFromEngine(blankEngine);
      setPackNotice({ kind: 'ok', text: `تم تحميل الخريطة "${newId}" — أضف المراسي الآن بالنقر عليها` });
    };
    reader.readAsDataURL(file);
  };

  const handleFinishZone = () => {
    const eng = engineRef.current;
    const renderer = rendererRef.current;
    if (!eng || !renderer || renderer.editorOverlay.draftZonePoints.length < 3) return;
    const zId = pointName.trim() || `zone_${Object.keys(eng.map.zones).length + 1}`;
    eng.map.zones[zId] = {
      id: zId,
      label: zId,
      polygon: [...renderer.editorOverlay.draftZonePoints]
    };
    eng.zones.set(zId, { id: zId, color: '#22c55e', targetOpacity: 0.3, opacity: 0.3, rate: 1 });
    renderer.editorOverlay.draftZonePoints = [];
    setDraftZoneCount(0);
    setPackVersion((v) => v + 1);
    setPackNotice({ kind: 'ok', text: `تم حفظ المنطقة: ${zId}` });
  };

  const handleClearDraftZone = () => {
    if (rendererRef.current) {
      rendererRef.current.editorOverlay.draftZonePoints = [];
    }
    setDraftZoneCount(0);
  };

  const handleSaveCurrentMap = () => {
    const eng = engineRef.current;
    if (!eng) return;
    registryRef.current!.saveCustomMap(eng.map);
    setPackVersion((v) => v + 1);
    setPackNotice({ kind: 'ok', text: `تم حفظ الخريطة "${eng.map.id}" في ذاكرة الاستوديو` });
  };

  const handleCreateStarterScenario = async () => {
    const eng = engineRef.current;
    if (!eng) return;
    registryRef.current!.saveCustomMap(eng.map);
    const anchorKeys = Object.keys(eng.map.anchors);
    const firstAnchor = anchorKeys[0];
    const secondAnchor = anchorKeys[1] ?? anchorKeys[0];

    const starter: ScenarioFile = {
      meta: { title: `سيناريو ${eng.map.title}`, map: eng.map.id },
      timeline: firstAnchor
        ? [
            {
              at: '0s',
              camera: { focus: firstAnchor, zoom: 1.2, duration: '1s' },
              caption: { text: `انطلاق من ${firstAnchor}` },
              spawn: [{ id: 'unit_1', actor: 'heavy_tank', at: firstAnchor, faction: 'blue' }]
            },
            {
              at: '1.5s',
              move: { entity: 'unit_1', to: secondAnchor },
              callout: { id: 'c_1', target: 'unit_1', text: 'وحدة اختبارية', color: '#38bdf8', duration: '5s' }
            }
          ]
        : []
    };
    const nextYaml = yaml.dump(starter);
    setYamlText(nextYaml);
    setActiveTab('play');
    setPlaying(true);
    await loadScenario(nextYaml, 'تم تجهيز سيناريو للخريطة المخصصة');
  };

  const handleUploadActorImage = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => setPendingActorDataUrl(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleSaveCustomActor = async () => {
    const id = newActorId.trim();
    const label = newActorLabel.trim() || id;
    if (!id || !pendingActorDataUrl) {
      setPackNotice({ kind: 'err', text: 'أدخل معرّف الكيان وارفع صورته أولًا' });
      return;
    }
    const reg = registryRef.current!;
    reg.saveCustomActor({ id, label, extends: newActorTpl, svg: pendingActorDataUrl });
    if (engineRef.current && rendererRef.current) {
      engineRef.current.actors = reg.actors;
      await rendererRef.current.syncActorTextures(reg.actors);
    }
    setPackVersion((v) => v + 1);
    setPendingActorDataUrl('');
    setNewActorId('');
    setNewActorLabel('');
    setPackNotice({ kind: 'ok', text: `تمت إضافة الكيان "${id}" (موروث من ${newActorTpl})` });
  };

  const handleExportPack = () => {
    const dump = yaml.dump(registryRef.current!.exportCurrentBundle());
    const url = URL.createObjectURL(new Blob([dump], { type: 'text/yaml' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'studio-bundle.pack.yaml';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    setPackNotice({ kind: 'ok', text: 'تم تصدير الحزمة الكاملة (.pack.yaml)' });
  };

  // AI Prompt & Catalog
  const handleCopyCatalog = async () => {
    const reg = registryRef.current!;
    const ok = await copyTextSafely(generateCatalogMarkdown(reg.maps, reg.actors));
    setStatusNotice(ok ? 'تم نسخ CATALOG.md إلى الحافظة' : 'تعذّر الوصول للحافظة');
  };

  const handleCopyAiPrompt = async () => {
    const reg = registryRef.current!;
    const topic = aiTopic.trim() || 'اشرح تحرك قافلة وتأمين نقطة عبور استراتيجية';
    const ok = await copyTextSafely(buildAiScenarioPrompt(reg.maps, reg.actors, topic));
    setStatusNotice(ok ? 'تم نسخ البرومبت + الفهرس بالكامل!' : 'تعذّر الوصول للحافظة');
  };

  // Audio + Video WebM recording
  const handleToggleRecord = () => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    if (recorderRef.current && recorderRef.current.state === 'recording') {
      recorderRef.current.stop();
      return;
    }

    if (typeof MediaRecorder === 'undefined' || !renderer.app.canvas.captureStream) {
      return;
    }

    const vStream = renderer.app.canvas.captureStream(30);
    const aStream = soundRef.current?.getAudioStream() ?? null;
    const tracks = [...vStream.getVideoTracks(), ...(aStream ? aStream.getAudioTracks() : [])];
    const combined = new MediaStream(tracks);
    const chunks: Blob[] = [];
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
      ? 'video/webm;codecs=vp9,opus'
      : MediaRecorder.isTypeSupported('video/webm')
        ? 'video/webm'
        : '';
    const rec = mimeType ? new MediaRecorder(combined, { mimeType }) : new MediaRecorder(combined);
    recorderRef.current = rec;

    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    rec.onstop = () => {
      renderer.hideUIHelpers = false;
      setRecording(false);
      const blob = new Blob(chunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'studio-export.webm';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    };

    renderer.hideUIHelpers = true;
    rec.start();
    setRecording(true);
  };

  const reg = registryRef.current!;
  // Reference packVersion to ensure sidebar re-reads updated maps & actors
  void packVersion;

  const activeRegionObj = hoveredRegionId ? activeMap.regions?.[hoveredRegionId] : undefined;
  const selectedRegionObj = selectedRegionId ? activeMap.regions?.[selectedRegionId] : undefined;
  const geoHoverText = geoLoadingMsg
    ? geoLoadingMsg
    : activeRegionObj
      ? activeRegionObj.nameAr
        ? `${activeRegionObj.nameAr} (${activeRegionObj.name})`
        : activeRegionObj.name
      : activeMap.geoLevel === 'world'
        ? 'مرّر على دولة للتحديد، وانقر مرتين للدخول للمحافظات'
        : `عدد المحافظات/المناطق: ${Object.keys(activeMap.zones).length}`;

  return (
    <div
      data-testid="studio-root"
      data-playing={String(playing)}
      data-tick={hudState.tick}
      data-entities={hudState.entityCount}
      data-scenario={selectedPreset}
      className="flex flex-col lg:grid lg:grid-cols-[390px_1fr] h-screen w-screen overflow-hidden bg-[#090f1a] text-slate-100"
    >
      <StudioSidebar
        activeTab={activeTab}
        onChangeTab={setActiveTab}
        presets={PRESET_OPTIONS}
        selectedPreset={selectedPreset}
        onSelectPreset={handleSelectPreset}
        playing={playing}
        onTogglePlay={() => setPlaying((p) => !p)}
        onRestart={handleRestart}
        speed={speed}
        onChangeSpeed={setSpeed}
        muted={muted}
        onToggleMute={handleToggleMute}
        recording={recording}
        onToggleRecord={handleToggleRecord}
        actors={reg.actors}
        activeTool={activeTool}
        onSelectTool={(tool) => {
          setActiveTool(tool);
          if (tool === 'select' && rendererRef.current) {
            rendererRef.current.selectedEntityId = null;
            setSelectedEntityId(null);
          }
        }}
        sandboxFaction={sandboxFaction}
        onSelectFaction={setSandboxFaction}
        selectedEntityId={selectedEntityId}
        aiTopic={aiTopic}
        onChangeAiTopic={setAiTopic}
        onCopyAiPrompt={handleCopyAiPrompt}
        onCopyCatalog={handleCopyCatalog}
        yamlText={yamlText}
        onChangeYaml={(val) => {
          setYamlText(val);
          if (statusNotice) setStatusNotice(null);
        }}
        onApplyYaml={() => loadScenario(yamlText, 'تم التحقق والتشغيل')}
        onUploadYamlFile={handleUploadYamlFile}
        onUploadMapImage={handleUploadMapImage}
        issues={issues}
        yamlSyntaxError={yamlSyntaxError}
        statusNotice={statusNotice}
        onOpenSpec={() => setSpecOpen(true)}
        maps={reg.maps}
        activeMapId={activeMap.id}
        onSelectActiveMap={handleSelectActiveMap}
        newMapId={newMapId}
        onChangeNewMapId={setNewMapId}
        onUploadNewMapImage={handleUploadNewMapImage}
        mapTool={mapTool}
        onSelectMapTool={setMapTool}
        pointName={pointName}
        onChangePointName={setPointName}
        draftZoneCount={draftZoneCount}
        onFinishZone={handleFinishZone}
        onClearDraftZone={handleClearDraftZone}
        onSaveCurrentMap={handleSaveCurrentMap}
        onCreateStarterScenario={handleCreateStarterScenario}
        newActorId={newActorId}
        onChangeNewActorId={setNewActorId}
        newActorLabel={newActorLabel}
        onChangeNewActorLabel={setNewActorLabel}
        newActorTpl={newActorTpl}
        onChangeNewActorTpl={setNewActorTpl}
        hasPendingActorImage={Boolean(pendingActorDataUrl)}
        onUploadActorImage={handleUploadActorImage}
        onSaveCustomActor={handleSaveCustomActor}
        onExportPack={handleExportPack}
        onImportPackFile={handleImportPackFile}
        packNotice={packNotice}
      />

      <main
        className="relative flex-1 min-h-0 h-full flex flex-col overflow-hidden bg-[#090f1a]"
        onDragOver={(e) => {
          e.preventDefault();
          if (!dragActive) setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleStageDrop}
      >
        <div className="relative flex-1 min-h-0 w-full">
          <div ref={stageHostRef} className="w-full h-full" />

          {/* Unobtrusive Stage Telemetry & Camera Strip + Geo Drill-Down HUD */}
          <div className="pointer-events-none absolute top-3 inset-x-3 flex flex-col gap-2 z-10">
            <div className="flex items-center justify-between gap-2">
              <div className="pointer-events-auto flex items-center gap-2 bg-slate-950/92 border border-slate-800 rounded-lg px-2.5 sm:px-3 py-1.5 text-xs text-slate-300 shadow-lg min-w-0">
                <span className="font-mono tabular-nums font-semibold text-sky-300 shrink-0" data-testid="sim-clock">
                  {formatSimTime(hudState.simTimeSec)}
                </span>
                <span aria-hidden="true" className="text-slate-600 hidden sm:inline">·</span>
                <span className="font-medium text-slate-200 truncate hidden sm:inline max-w-[200px] md:max-w-none">
                  {activeMap.title}
                </span>
                <span aria-hidden="true" className="text-slate-600">·</span>
                <span className="tabular-nums text-slate-400 whitespace-nowrap" data-testid="entity-count">
                  الكيانات: {hudState.entityCount}
                </span>
                <span aria-hidden="true" className="text-slate-600 hidden md:inline">·</span>
                <span className="tabular-nums text-slate-400 whitespace-nowrap hidden md:inline">
                  الخطوات: {hudState.executedSteps}/{hudState.totalSteps}
                </span>
              </div>

              <div className="pointer-events-auto flex items-center gap-0.5 sm:gap-1 bg-slate-950/92 border border-slate-800 rounded-lg p-1 shadow-lg shrink-0">
                <button
                  type="button"
                  onClick={handleToggleAnchors}
                  aria-label={showAnchors ? 'إخفاء المراسي' : 'إظهار المراسي'}
                  title={showAnchors ? 'إخفاء المراسي' : 'إظهار المراسي'}
                  className="p-1.5 rounded text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                >
                  {showAnchors ? <Eye className="w-4 h-4 text-amber-300" /> : <EyeOff className="w-4 h-4 text-slate-500" />}
                </button>
                <button
                  type="button"
                  onClick={() => rendererRef.current?.zoomBy(1.18)}
                  aria-label="تكبير الخريطة"
                  title="تكبير الخريطة"
                  className="p-1.5 rounded text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => rendererRef.current?.zoomBy(0.85)}
                  aria-label="تصغير الخريطة"
                  title="تصغير الخريطة"
                  className="p-1.5 rounded text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => rendererRef.current?.resetCamera()}
                  aria-label="ملاءمة الخريطة"
                  title="ملاءمة الخريطة"
                  className="p-1.5 rounded text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                >
                  <Maximize2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {activeMap.geoLevel && (
              <div
                id="geoHud"
                className="pointer-events-auto self-start max-w-full flex flex-wrap items-center gap-2 bg-slate-950/92 border border-slate-700/90 rounded-lg px-3 py-1.5 text-xs shadow-lg"
              >
                <span id="geoBreadcrumb" className="font-semibold text-sky-300 whitespace-nowrap">
                  {activeMap.geoLevel === 'country'
                    ? `🌍 العالم ◂ ${activeMap.title.replace(' — المحافظات', '')}`
                    : '🌍 العالم'}
                </span>
                <span
                  id="geoHoverLabel"
                  className="bg-slate-900 border border-slate-700 text-slate-200 px-2 py-0.5 rounded truncate max-w-[260px] sm:max-w-[380px]"
                >
                  {geoHoverText}
                </span>
                {activeMap.geoLevel === 'world' && selectedRegionId && selectedRegionObj?.iso3 && (
                  <button
                    type="button"
                    id="drillDownBtn"
                    onClick={() => void enterCountryProvinces(selectedRegionId)}
                    className="px-2.5 py-0.5 font-semibold bg-sky-600 hover:bg-sky-500 text-white border border-sky-400 rounded whitespace-nowrap shrink-0 transition-colors"
                  >
                    دخول إلى محافظات {selectedRegionObj.nameAr ?? selectedRegionObj.name} ↗
                  </button>
                )}
                {activeMap.geoLevel === 'country' && (
                  <button
                    type="button"
                    id="backWorldBtn"
                    onClick={() => void handleSelectPreset('world')}
                    className="px-2.5 py-0.5 font-medium bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-600 rounded whitespace-nowrap shrink-0 transition-colors"
                  >
                    ↩ العودة لخريطة العالم
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Blocked Navigation / Error Toast */}
          {toastMsg && (
            <div
              id="toastBar"
              role="alert"
              className="pointer-events-none absolute top-24 left-1/2 -translate-x-1/2 z-20 max-w-[90%] bg-red-950/95 border border-red-400 text-red-100 px-4 py-2 rounded-lg text-xs sm:text-sm font-medium text-center shadow-xl"
            >
              {toastMsg}
            </div>
          )}

          {/* Drag & Drop Overlay */}
          {dragActive && (
            <div className="pointer-events-none absolute inset-4 z-20 flex items-center justify-center rounded-xl border-2 border-dashed border-sky-400 bg-slate-950/85">
              <p className="text-base font-semibold text-sky-300">
                أفلت ملف السيناريو (.yaml) أو الحزمة (.pack.yaml) أو صورة الخريطة هنا
              </p>
            </div>
          )}

          {/* Cinematic Caption Bar */}
          {hudState.caption && (
            <div
              id="captionBar"
              data-testid="caption-bar"
              className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 z-10 max-w-[85%] bg-slate-950/92 border border-sky-500/70 px-5 py-2 rounded-lg text-sm sm:text-base font-medium text-slate-100 text-center shadow-xl"
            >
              {hudState.caption}
            </div>
          )}
        </div>

        {/* Deterministic Timeline Scrubber */}
        <div
          aria-label="شريط الزمن التفاعلي"
          className="bg-slate-900 border-t border-slate-800 px-4 py-2 flex items-center gap-3 text-xs shrink-0"
        >
          <span id="timeLabel" className="font-mono tabular-nums text-sky-300 w-12 shrink-0 text-center">
            {hudState.simTimeSec.toFixed(1)}s
          </span>
          <input
            id="timeScrubber"
            type="range"
            aria-label="التقديم والترجيع في شريط الزمن"
            min={0}
            max={hudState.maxTicks}
            value={Math.min(hudState.maxTicks, hudState.tick)}
            onChange={(e) => handleScrub(parseInt(e.target.value, 10))}
            className="flex-1 accent-sky-400 cursor-pointer"
          />
          <span id="durLabel" className="font-mono tabular-nums text-slate-400 w-12 shrink-0 text-center">
            {(hudState.maxTicks / TICK_RATE).toFixed(1)}s
          </span>
        </div>
      </main>

      <SpecModal
        open={specOpen}
        onClose={() => setSpecOpen(false)}
        activeMap={activeMap}
        maps={reg.maps}
        actors={reg.actors}
      />
    </div>
  );
}

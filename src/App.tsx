import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as yaml from 'js-yaml';
import { Eye, EyeOff, Layers, Maximize2, Pause, Play, Truck, Wrench, X, ZoomIn, ZoomOut } from 'lucide-react';
import { ActionRecorder } from './core/actionRecorder';
import { buildAiScenarioPrompt, generateCatalogMarkdown } from './core/catalog';
import { DT, StudioEngine, TICK_RATE } from './core/engine';
import { isPointNearWalkable } from './core/pathfinding';
import {
  Faction,
  MapPack,
  StrikeMode,
  NavCell,
  PackBundle,
  Point,
  SavedScenarioRecord,
  ScenarioFile,
  ValidationIssue
} from './core/types';
import { validateScenario } from './core/validator';
import { buildCountryProvincesMapPack } from './maps/worldGeoEngine';
import { PackRegistry } from './packs/packRegistry';
import { SoundSynth } from './renderer/soundSynth';
import { StudioRenderer } from './renderer/studioRenderer';
import { studioDb } from './storage/studioDb';
import { MapEditTool } from './components/PackBuilderPanel';
import { SpecModal } from './components/SpecModal';
import { StudioSidebar } from './components/StudioSidebar';

const BLANK_SCENARIO_YAML = `meta:
  title: لوحة فارغة
  map: world_live
timeline: []
`;

const FACTION_HEX: Record<Faction, string> = {
  blue: '#38bdf8',
  red: '#ef4444',
  neutral: '#f59e0b'
};

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
    registryRef.current = new PackRegistry(true);
  }

  const stageHostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<StudioRenderer | null>(null);
  const engineRef = useRef<StudioEngine | null>(null);
  const soundRef = useRef<SoundSynth | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const actionRecorderRef = useRef<ActionRecorder>(new ActionRecorder());

  // Refs synced for 60fps loop and Pixi callbacks
  const playingRef = useRef(true);
  const speedRef = useRef(1);
  const activeToolRef = useRef<string>('select');
  const sandboxFactionRef = useRef<Faction>('blue');
  const sandboxCounterRef = useRef(1);
  const toolScalesRef = useRef<Record<string, number>>({});
  const mapToolRef = useRef<MapEditTool>('anchor');
  const pointNameRef = useRef<string>('');
  const pendingActionModeRef = useRef<
    'none' | 'arrow_start' | 'arrow_end' | 'pulse' | 'strike_air' | 'strike_missile' | 'strike_direct' | 'strike_gunfire'
  >('none');
  const arrowStartPtRef = useRef<Point | null>(null);

  const toastTimerRef = useRef<number | null>(null);

  const [packVersion, setPackVersion] = useState(0);
  const [activeTab, setActiveTab] = useState<'play' | 'pack'>('play');
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>('');
  const [yamlText, setYamlText] = useState(BLANK_SCENARIO_YAML);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [muted, setMuted] = useState(false);
  const [recording, setRecording] = useState(false);
  const [unitScale, setUnitScale] = useState(1.0);
  const [activeTool, setActiveTool] = useState<string>('select');
  const [strikeMode, setStrikeMode] = useState<'none' | StrikeMode>('none');
  const [armedActorId, setArmedActorId] = useState<string | null>(null);
  const armedActorRef = useRef<string | null>(null);
  const [sandboxFaction, setSandboxFaction] = useState<Faction>('blue');
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [selectedEntityScale, setSelectedEntityScale] = useState<number>(1.0);
  const [toolScales, setToolScales] = useState<Record<string, number>>({});
  const [aiTopic, setAiTopic] = useState('');
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [yamlSyntaxError, setYamlSyntaxError] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [showAnchors, setShowAnchors] = useState(true);
  const [specOpen, setSpecOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [activeMap, setActiveMap] = useState<MapPack>(
    registryRef.current.maps.world_live
  );
  const [hoveredRegionId, setHoveredRegionId] = useState<string | null>(null);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [geoLoadingMsg, setGeoLoadingMsg] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [unitsOpen, setUnitsOpen] = useState(false);
  const [mapToolsOpen, setMapToolsOpen] = useState(false);

  // Live ActionRecorder UI state
  const [actionRecording, setActionRecording] = useState(false);
  const [recStats, setRecStats] = useState({ clockSec: 0, stepCount: 0 });
  const [pendingSaveMode, setPendingSaveMode] = useState<'recorded' | 'code' | null>(null);
  const [saveDraftTitle, setSaveDraftTitle] = useState('');

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

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        pendingActionModeRef.current = 'none';
        arrowStartPtRef.current = null;
        armedActorRef.current = null;
        setArmedActorId(null);
        setStrikeMode('none');
        if (rendererRef.current) {
          rendererRef.current.selectedEntityId = null;
        }
        setSelectedEntityId(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

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
    const hasSteps = (eng.scenario.timeline?.length ?? 0) > 0;
    const maxTicks = hasSteps ? Math.max(60, Math.ceil(eng.estimateDurationSec() * TICK_RATE)) : 600;
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

  const attachEngineListeners = useCallback(
    (eng: StudioEngine) => {
      if (soundRef.current) {
        eng.onSound((id) => soundRef.current?.play(id));
      }
      eng.onMoveBlocked((ent) => {
        showToast(
          ent.domain === 'land'
            ? '⚠️ لا يوجد مسار بري متصل — الدبابات والمشاة لا تعبر البحر!'
            : '⚠️ لا يوجد مسار بحري متصل — السفن لا تعبر اليابسة!'
        );
      });
    },
    [showToast]
  );

  const cancelActiveActionRecording = useCallback(() => {
    if (actionRecorderRef.current.isRecording) {
      actionRecorderRef.current.stop();
      setActionRecording(false);
    }
    pendingActionModeRef.current = 'none';
    arrowStartPtRef.current = null;
    setStrikeMode('none');
  }, []);

  const openEmptyMapBoard = useCallback(
    async (mapId: string, preserveRecording = false) => {
      const reg = registryRef.current!;
      const map = reg.maps[mapId];
      if (!map) return;

      if (!preserveRecording) cancelActiveActionRecording();
      setIssues([]);
      setYamlSyntaxError(null);
      setStatusNotice(null);

      const blankScenario: ScenarioFile = {
        meta: { title: `لوح حر: ${map.title}`, map: map.id },
        timeline: []
      };
      const engine = new StudioEngine(map, reg.actors, blankScenario);
      attachEngineListeners(engine);
      engineRef.current = engine;
      setActiveMap(map);
      setSelectedEntityId(null);
      setHoveredRegionId(null);
      setSelectedRegionId(null);
      sandboxCounterRef.current = 1;

      if (rendererRef.current) {
        await rendererRef.current.loadEngineAssets(engine);
      }

      syncHudFromEngine(engine);
      await studioDb.setSetting('lastMapId', map.id);
      await studioDb.setSetting('lastScenarioId', '');
    },
    [attachEngineListeners, cancelActiveActionRecording, syncHudFromEngine]
  );

  const loadScenario = useCallback(
    async (rawYaml: string, noticeText: string | null = null, savedScenarioId?: string): Promise<boolean> => {
      const reg = registryRef.current!;
      cancelActiveActionRecording();
      setIssues([]);
      setYamlSyntaxError(null);
      setStatusNotice(null);

      try {
        const parsed = yaml.load(rawYaml) as ScenarioFile;
        const map = reg.maps[parsed?.meta?.map];
        const foundIssues = validateScenario(parsed, map, reg.actors);
        if (foundIssues.length > 0) {
          setIssues(foundIssues);
          return false;
        }

        const engine = new StudioEngine(map, reg.actors, parsed);
        attachEngineListeners(engine);
        engineRef.current = engine;
        setActiveMap(map);
        setSelectedEntityId(null);
        setHoveredRegionId(null);
        setSelectedRegionId(null);

        if (rendererRef.current) {
          await rendererRef.current.loadEngineAssets(engine);
        }

        syncHudFromEngine(engine);
        await studioDb.setSetting('lastMapId', map.id);
        if (savedScenarioId !== undefined) {
          await studioDb.setSetting('lastScenarioId', savedScenarioId);
        }
        if (noticeText) {
          setStatusNotice(noticeText);
        }
        return true;
      } catch (err) {
        setYamlSyntaxError((err as Error).message);
        return false;
      }
    },
    [attachEngineListeners, cancelActiveActionRecording, syncHudFromEngine]
  );

  const enterCountryProvinces = useCallback(
    async (regionId: string) => {
      const eng = engineRef.current;
      const renderer = rendererRef.current;
      const reg = registryRef.current!;
      const regMap = eng?.map.regions?.[regionId];
      if (!eng || !renderer || !regMap?.iso3) return;

      const title = regMap.nameAr ? `${regMap.nameAr} (${regMap.name})` : regMap.name;
      setGeoLoadingMsg(`⏳ جاري تحميل محافظات ${title}...`);
      renderer.focusRegion(eng, regionId);

      try {
        const cachedId = `country_${regMap.iso3.toLowerCase()}`;
        let countryMap = reg.maps[cachedId];
        if (!countryMap) {
          countryMap = await buildCountryProvincesMapPack(regMap.iso3, title);
          await reg.saveCustomMap(countryMap);
        }
        setPackVersion((v) => v + 1);
        setPlaying(true);
        await openEmptyMapBoard(countryMap.id);
        setStatusNotice(`خريطة محافظات ${title} جاهزة — حرّك وحداتك أو ابدأ تسجيل سيناريو الآن`);
      } catch (err) {
        showToast((err as Error).message);
      } finally {
        setGeoLoadingMsg(null);
      }
    },
    [openEmptyMapBoard, showToast]
  );

  // Initialize PackRegistry (IndexedDB), PixiJS StudioRenderer, & 30 TPS loop once
  useEffect(() => {
    const host = stageHostRef.current;
    if (!host) return;

    let cancelled = false;
    let rafId = 0;

    const sound = new SoundSynth();
    soundRef.current = sound;

    const renderer = new StudioRenderer();
    rendererRef.current = renderer;

    renderer.onSelectionChange = (id) => {
      setSelectedEntityId(id);
      const ent = id ? engineRef.current?.entities.get(id) : undefined;
      setSelectedEntityScale(ent?.scaleMul ?? 1.0);
    };
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

    renderer.onMapClick = (pt: Point, hitId: string | null, shiftKey = false) => {
      const eng = engineRef.current;
      const reg = registryRef.current;
      const rec = actionRecorderRef.current;
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

      // أوضاع الرسم السريع أو القصف الجوي/الصاروخي
      if (pendingActionModeRef.current === 'arrow_start') {
        arrowStartPtRef.current = pt;
        pendingActionModeRef.current = 'arrow_end';
        showToast('الآن اضغط نقطة نهاية السهم على الخريطة');
        return;
      }
      if (pendingActionModeRef.current === 'arrow_end' && arrowStartPtRef.current) {
        const id = `arr_${Date.now()}`;
        eng.arrows.set(id, {
          id,
          from: arrowStartPtRef.current,
          to: pt,
          color: '#f59e0b',
          dashed: true,
          progress: 0,
          rate: 0.8
        });
        rec.recordArrow(id, arrowStartPtRef.current, pt, '#f59e0b', true);
        pendingActionModeRef.current = 'none';
        arrowStartPtRef.current = null;
        return;
      }
      if (pendingActionModeRef.current === 'pulse') {
        eng.pulses.push({ x: pt.x, y: pt.y, color: '#ef4444', maxRadius: 70, progress: 0 });
        rec.recordPulse(pt, '#ef4444');
        pendingActionModeRef.current = 'none';
        return;
      }
      if (
        pendingActionModeRef.current === 'strike_air' ||
        pendingActionModeRef.current === 'strike_missile' ||
        pendingActionModeRef.current === 'strike_direct' ||
        pendingActionModeRef.current === 'strike_gunfire' ||
        (shiftKey && renderer.selectedEntityId)
      ) {
        const selected = renderer.selectedEntityId ? eng.entities.get(renderer.selectedEntityId) : undefined;
        const pending = pendingActionModeRef.current;
        const mode: StrikeMode =
          pending === 'strike_air'
            ? 'airstrike'
            : pending === 'strike_missile'
              ? 'missile'
              : pending === 'strike_direct'
                ? 'direct'
                : pending === 'strike_gunfire'
                  ? 'gunfire'
                  : selected?.kind === 'air'
                    ? 'airstrike'
                    : 'missile';
        const faction = selected?.faction ?? sandboxFactionRef.current;
        const allEntities = [...eng.entities.values()];

        // الوحدة المفعّلة من لوحة الآليات هي التي تُطلق، ويبقى الإطلاق مفعّلاً حتى يوقفه الزر
        const armedId = armedActorRef.current;
        const armedUnit = armedId
          ? selected?.actorId === armedId && selected.faction === faction
            ? selected
            : allEntities.find((e) => e.actorId === armedId && e.faction === faction)
          : undefined;
        if (armedId && !armedUnit) {
          showToast('⚠️ ضع الوحدة على الخريطة أولاً، ثم اختر الهدف');
          return;
        }
        const ability = armedId && reg.actors[armedId]?.fire?.mode === mode ? reg.actors[armedId]?.fire : undefined;

        const legacyAttacker =
          mode === 'airstrike'
            ? (selected?.kind === 'air' && !selected.isMoving && !selected.pendingStrike
                ? selected
                : allEntities.find((e) => e.kind === 'air' && e.faction === faction && !e.isMoving && !e.pendingStrike) ??
                  (selected?.kind === 'air' ? selected : undefined) ??
                  allEntities.find((e) => e.kind === 'air' && e.faction === faction) ??
                  allEntities.find((e) => e.kind === 'air'))
            : selected?.actorId === 'ballistic_launcher' ||
                selected?.actorId === 'destroyer_ship' ||
                selected?.kind === 'air'
              ? selected
              : allEntities.find(
                  (e) =>
                    e.faction === faction &&
                    (e.actorId === 'ballistic_launcher' ||
                      e.actorId === 'destroyer_ship' ||
                      e.actorId === 'military_base')
                );

        const attacker = armedUnit ?? legacyAttacker;

        const fallbackFrom =
          mode === 'airstrike' && !attacker
            ? { x: Math.max(30, pt.x - 190), y: Math.max(30, pt.y - 120) }
            : !attacker
              ? { x: Math.max(30, pt.x - 170), y: Math.min(eng.map.height - 30, pt.y + 120) }
              : undefined;

        eng.dispatchOrder({
          type: 'strike',
          attackerId: attacker?.id,
          mode,
          from: fallbackFrom,
          to: pt,
          radius: ability?.radius,
          color: ability?.color,
          faction
        });
        eng.flushOrders();
        rec.recordStrike(mode, pt, attacker?.id, fallbackFrom);
        syncHudFromEngine(eng);
        return;
      }

      const tool = activeToolRef.current;
      if (tool === 'select') {
        if (hitId) {
          renderer.selectedEntityId = hitId;
          setSelectedEntityId(hitId);
          setSelectedEntityScale(eng.entities.get(hitId)?.scaleMul ?? 1.0);
        } else if (renderer.selectedEntityId) {
          eng.dispatchOrder({ type: 'move', entityId: renderer.selectedEntityId, to: pt });
          eng.flushOrders();
          rec.recordMove(renderer.selectedEntityId, pt);
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
        const spawnScale = toolScalesRef.current[actor.id] ?? 1.0;
        if (actor.kind === 'building') {
          eng.dispatchOrder({ type: 'construct', id, actorId: actor.id, at: pt, faction, durationSec: 1.8, scale: spawnScale });
          rec.recordConstruct(id, actIdFallback(actor.id), pt, faction, 1.8, spawnScale);
          renderer.selectedEntityId = id;
          setSelectedEntityId(id);
          setSelectedEntityScale(spawnScale);
        } else {
          eng.dispatchOrder({ type: 'spawn', id, actorId: actor.id, at: pt, faction, scale: spawnScale });
          rec.recordSpawn(id, actor.id, pt, faction, spawnScale);
          renderer.selectedEntityId = id;
          setSelectedEntityId(id);
          setSelectedEntityScale(spawnScale);
          setActiveTool('select');
        }
        eng.flushOrders();
        syncHudFromEngine(eng);
      }
    };

    const actIdFallback = (id: string) => id;

    const boot = async () => {
      const reg = registryRef.current!;
      await reg.init([]);
      await renderer.init(host);
      if (cancelled) return;

      const savedScale = await studioDb.getSetting<number>('unitScale');
      if (savedScale && Number.isFinite(savedScale)) {
        renderer.userUnitScale = savedScale;
        setUnitScale(savedScale);
      }

      const lastScenId = await studioDb.getSetting<string>('lastScenarioId');
      const lastMapId = await studioDb.getSetting<string>('lastMapId');
      setPackVersion((v) => v + 1);

      const initialScen =
        lastScenId !== undefined
          ? lastScenId
            ? reg.scenarios.find((s) => s.id === lastScenId)
            : undefined
          : reg.scenarios[0];

      if (initialScen) {
        setSelectedScenarioId(initialScen.id);
        setYamlText(initialScen.yaml);
        await loadScenario(initialScen.yaml, null, initialScen.id);
      } else if (lastMapId && reg.maps[lastMapId]) {
        await openEmptyMapBoard(lastMapId);
      } else {
        await openEmptyMapBoard('world_live');
      }

      let accumulator = 0;
      let lastTime = performance.now();
      let lastHudTenths = -1;
      let lastHudCaption = '';
      let lastHudEntities = -1;
      let lastHudSteps = -1;
      let lastRecTenths = -1;
      let lastRecCount = -1;

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

        const rec = actionRecorderRef.current;
        if (rec.isRecording) {
          const recSec = rec.elapsedSec();
          const recTenths = Math.floor(recSec * 10);
          if (recTenths !== lastRecTenths || rec.steps.length !== lastRecCount) {
            lastRecTenths = recTenths;
            lastRecCount = rec.steps.length;
            setRecStats({ clockSec: recSec, stepCount: rec.steps.length });
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
            const hasSteps = (eng.scenario.timeline?.length ?? 0) > 0;
            const maxTicks = hasSteps ? Math.max(60, Math.ceil(eng.estimateDurationSec() * TICK_RATE)) : 600;
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

    void boot();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      if (recorderRef.current && recorderRef.current.state === 'recording') {
        recorderRef.current.stop();
      }
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
      renderer.destroy();
    };
  }, [enterCountryProvinces, loadScenario, openEmptyMapBoard, showToast, syncHudFromEngine]);

  const handleChangeUnitScale = async (nextScale: number) => {
    setUnitScale(nextScale);
    if (rendererRef.current) {
      rendererRef.current.userUnitScale = nextScale;
    }
    await studioDb.setSetting('unitScale', nextScale);
  };

  const handleChangeSelectedEntityScale = (nextScale: number) => {
    const eng = engineRef.current;
    const entityId = rendererRef.current?.selectedEntityId;
    if (!eng || !entityId) return;
    const clamped = Number(Math.max(0.3, Math.min(2.8, nextScale)).toFixed(2));
    setSelectedEntityScale(clamped);
    eng.dispatchOrder({ type: 'resize', entityId, scale: clamped });
    eng.flushOrders();
    actionRecorderRef.current.recordResize(entityId, clamped);
  };

  const handleChangeToolScale = (toolId: string, nextScale: number) => {
    const clamped = Number(Math.max(0.3, Math.min(2.8, nextScale)).toFixed(2));
    toolScalesRef.current = { ...toolScalesRef.current, [toolId]: clamped };
    setToolScales((prev) => ({ ...prev, [toolId]: clamped }));
  };

  // Live ActionRecorder handlers
  const handleStartActionRecord = async () => {
    const eng = engineRef.current;
    const renderer = rendererRef.current;
    if (!eng || !renderer) return;
    await openEmptyMapBoard(eng.map.id, true);
    setPlaying(true);
    actionRecorderRef.current.start(eng.map.id, renderer.getCameraState());
    setPendingSaveMode(null);
    setActionRecording(true);
    setRecStats({ clockSec: 0, stepCount: actionRecorderRef.current.steps.length });
  };

  const handleRequestStopActionRecord = () => {
    actionRecorderRef.current.stop();
    setActionRecording(false);
    pendingActionModeRef.current = 'none';
    setSaveDraftTitle(`سيناريو مسجّل (${activeMap.title})`);
    setPendingSaveMode('recorded');
  };

  const handleRequestSaveYaml = async () => {
    const ok = await loadScenario(yamlText);
    if (!ok) return;
    const parsed = yaml.load(yamlText) as ScenarioFile;
    setSaveDraftTitle(parsed?.meta?.title || `سيناريو (${activeMap.title})`);
    setPendingSaveMode('code');
  };

  const handleConfirmSaveScenario = async () => {
    const reg = registryRef.current!;
    const title = saveDraftTitle.trim() || `سيناريو (${activeMap.title})`;
    if (pendingSaveMode === 'recorded') {
      const generatedYaml = actionRecorderRef.current.toYaml(title);
      setYamlText(generatedYaml);
      const rec: SavedScenarioRecord = {
        id: `rec_${Date.now()}`,
        title,
        mapId: actionRecorderRef.current.mapId || activeMap.id,
        yaml: generatedYaml,
        source: 'recorded',
        updatedAt: Date.now()
      };
      await reg.saveScenarioRecord(rec);
      setSelectedScenarioId(rec.id);
      setPackVersion((v) => v + 1);
      setPendingSaveMode(null);
      setPlaying(true);
      await loadScenario(
        generatedYaml,
        `تم حفظ "${title}" (${actionRecorderRef.current.steps.length} خطوة) في قاعدة البيانات`,
        rec.id
      );
    } else if (pendingSaveMode === 'code') {
      const parsed = yaml.load(yamlText) as ScenarioFile;
      const rec: SavedScenarioRecord = {
        id: `scen_${Date.now()}`,
        title,
        mapId: parsed?.meta?.map ?? activeMap.id,
        yaml: yamlText,
        source: 'code',
        updatedAt: Date.now()
      };
      await reg.saveScenarioRecord(rec);
      setSelectedScenarioId(rec.id);
      setPackVersion((v) => v + 1);
      setPendingSaveMode(null);
      await studioDb.setSetting('lastScenarioId', rec.id);
      setStatusNotice(`تم حفظ "${title}" في قاعدة البيانات!`);
    }
  };

  const handleLoadSelectedScenario = async () => {
    const rec = registryRef.current!.scenarios.find((s) => s.id === selectedScenarioId);
    if (!rec) return;
    setYamlText(rec.yaml);
    setPlaying(true);
    await loadScenario(rec.yaml, `تم تشغيل "${rec.title}"`, rec.id);
  };

  const handleDeleteSelectedScenario = async () => {
    if (!selectedScenarioId) return;
    const deletedId = selectedScenarioId;
    const reg = registryRef.current!;
    await reg.deleteScenarioRecord(deletedId);
    setPackVersion((v) => v + 1);
    const nextId = reg.scenarios[0]?.id ?? '';
    setSelectedScenarioId(nextId);
    const storedLastId = await studioDb.getSetting<string>('lastScenarioId');
    if (storedLastId === deletedId) {
      await studioDb.setSetting('lastScenarioId', nextId);
    }
    setStatusNotice('تم حذف السيناريو من السجل');
  };

  const handleRecCamera = () => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const c = renderer.getCameraState();
    actionRecorderRef.current.recordCamera(c.x, c.y, c.zoom);
    showToast('📷 تم تسجيل لقطة الكاميرا الحالية');
  };

  const handleRecCaptionSubmit = (text: string) => {
    if (!engineRef.current) return;
    engineRef.current.caption = text;
    actionRecorderRef.current.recordCaption(text);
    syncHudFromEngine(engineRef.current);
  };

  const handleRecZone = () => {
    const eng = engineRef.current;
    const regId = rendererRef.current?.selectedRegionId;
    if (!eng || !regId || !eng.zones.has(regId)) {
      showToast('حدد دولة أو محافظة أولًا (في وضع التحديد) ثم اضغط تلوين');
      return;
    }
    const z = eng.zones.get(regId)!;
    const col = FACTION_HEX[sandboxFactionRef.current];
    z.color = col;
    z.targetOpacity = 0.38;
    z.opacity = 0.38;
    actionRecorderRef.current.recordZone(z.id, col, 0.38);
  };

  const handleRecArrow = () => {
    pendingActionModeRef.current = 'arrow_start';
    showToast('اضغط نقطة بداية السهم ثم نقطة نهايته على الخريطة');
  };

  const handleRecPulse = () => {
    pendingActionModeRef.current = 'pulse';
    showToast('اضغط على الخريطة لوضع موجة تنبيه');
  };

  const handleRecDeleteUnit = () => {
    const eng = engineRef.current;
    const renderer = rendererRef.current;
    if (!eng || !renderer?.selectedEntityId) return;
    const id = renderer.selectedEntityId;
    eng.dispatchOrder({ type: 'remove', entityId: id });
    eng.flushOrders();
    actionRecorderRef.current.recordRemove(id);
    renderer.selectedEntityId = null;
    setSelectedEntityId(null);
    syncHudFromEngine(eng);
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
    const selId = rendererRef.current?.selectedEntityId;
    if (selId) {
      const selEnt = eng.entities.get(selId);
      setSelectedEntityScale(selEnt?.scaleMul ?? 1.0);
    }
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

  const handleUploadMapImage = (file: File) => {
    const eng = engineRef.current;
    const renderer = rendererRef.current;
    if (!eng || !renderer) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      if (!dataUrl || !engineRef.current || !rendererRef.current) return;
      engineRef.current.map.svgOrUrl = dataUrl;
      await rendererRef.current.loadEngineAssets(engineRef.current);
      setStatusNotice('تم تحديث صورة الخريطة الحالية');
    };
    reader.readAsDataURL(file);
  };

  const handleImportPackFile = async (file: File) => {
    try {
      const text = await file.text();
      const bundle = yaml.load(text) as PackBundle;
      const reg = registryRef.current!;
      const res = await reg.importBundle(bundle);
      if (engineRef.current && rendererRef.current) {
        engineRef.current.actors = reg.actors;
        await rendererRef.current.syncActorTextures(reg.actors);
        const updatedCurrentMap = bundle.maps?.find((m) => m.id === engineRef.current?.map.id);
        if (updatedCurrentMap) {
          await openEmptyMapBoard(updatedCurrentMap.id);
        }
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
  const handleSelectActiveMapForBuilder = async (mapId: string) => {
    await openEmptyMapBoard(mapId);
    if (rendererRef.current) {
      rendererRef.current.editorOverlay.draftZonePoints = [];
      setDraftZoneCount(0);
    }
    setPackNotice({ kind: 'ok', text: `تم فتح الخريطة "${mapId}" للتحرير` });
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
        unitScaleMultiplier: 0.85,
        anchors: {},
        zones: {}
      };
      await reg.saveCustomMap(newMap);
      setPackVersion((v) => v + 1);
      await openEmptyMapBoard(newId);
      if (rendererRef.current) {
        rendererRef.current.editorOverlay.draftZonePoints = [];
        setDraftZoneCount(0);
      }
      setPackNotice({ kind: 'ok', text: `تم تحميل وحفظ الخريطة "${newId}" في قاعدة البيانات` });
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

  const handleSaveCurrentMap = async () => {
    const eng = engineRef.current;
    if (!eng) return;
    await registryRef.current!.saveCustomMap(eng.map);
    setPackVersion((v) => v + 1);
    setPackNotice({ kind: 'ok', text: `تم حفظ الخريطة "${eng.map.id}" في قاعدة البيانات` });
  };

  const handleCreateStarterScenario = async () => {
    const eng = engineRef.current;
    if (!eng) return;
    await registryRef.current!.saveCustomMap(eng.map);
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
    await reg.saveCustomActor({ id, label, extends: newActorTpl, svg: pendingActorDataUrl });
    if (engineRef.current && rendererRef.current) {
      engineRef.current.actors = reg.actors;
      await rendererRef.current.syncActorTextures(reg.actors);
    }
    setPackVersion((v) => v + 1);
    setPendingActorDataUrl('');
    setNewActorId('');
    setNewActorLabel('');
    setPackNotice({ kind: 'ok', text: `تم حفظ الكيان "${id}" في قاعدة البيانات` });
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
    const topic = aiTopic.trim() || `سيناريو على خريطة ${activeMap.title}`;
    const ok = await copyTextSafely(buildAiScenarioPrompt(reg.maps, reg.actors, topic));
    setStatusNotice(ok ? 'تم نسخ البرومبت + الفهرس بالكامل للخرائط والمحافظات!' : 'تعذّر الوصول للحافظة');
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
        ? ''
        : `عدد المحافظات/المناطق: ${Object.keys(activeMap.zones).length}`;

  const handleToggleAbility = (actorId: string) => {
    const fire = registryRef.current?.actors[actorId]?.fire;
    if (!fire) return;
    if (armedActorRef.current === actorId) {
      armedActorRef.current = null;
      setArmedActorId(null);
      setStrikeMode('none');
      pendingActionModeRef.current = 'none';
      return;
    }
    armedActorRef.current = actorId;
    setArmedActorId(actorId);
    setStrikeMode(fire.mode);
    pendingActionModeRef.current =
      fire.mode === 'airstrike'
        ? 'strike_air'
        : fire.mode === 'missile'
          ? 'strike_missile'
          : fire.mode === 'direct'
            ? 'strike_direct'
            : 'strike_gunfire';
    setActiveTool('select');
    showToast(`${fire.label}: اضغط على الهدف، واضغط الزر نفسه للإيقاف`);
  };

  const renderStudioSidebar = (view: 'tools' | 'units') => (
      <StudioSidebar
        view={view}
        activeTab={activeTab}
        onChangeTab={setActiveTab}
        maps={reg.maps}
        activeMapId={activeMap.id}
        onSelectEnvironmentMap={(id) => void openEmptyMapBoard(id)}
        onClearBoard={() => void openEmptyMapBoard(activeMap.id)}
        unitScale={unitScale}
        onChangeUnitScale={(s) => void handleChangeUnitScale(s)}
        actionRecording={actionRecording}
        recClockSec={recStats.clockSec}
        recStepCount={recStats.stepCount}
        onStartActionRecord={() => void handleStartActionRecord()}
        onRequestStopActionRecord={handleRequestStopActionRecord}
        onRecCamera={handleRecCamera}
        onRecCaptionSubmit={handleRecCaptionSubmit}
        onRecZone={handleRecZone}
        onRecArrow={handleRecArrow}
        onRecPulse={handleRecPulse}
        onRecDeleteUnit={handleRecDeleteUnit}
        pendingSaveMode={pendingSaveMode}
        saveDraftTitle={saveDraftTitle}
        onChangeSaveDraftTitle={setSaveDraftTitle}
        onConfirmSaveScenario={() => void handleConfirmSaveScenario()}
        onCancelSaveScenario={() => setPendingSaveMode(null)}
        scenarios={reg.scenarios}
        selectedScenarioId={selectedScenarioId}
        onSelectScenarioId={setSelectedScenarioId}
        onLoadSelectedScenario={() => void handleLoadSelectedScenario()}
        onDeleteSelectedScenario={() => void handleDeleteSelectedScenario()}
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
          pendingActionModeRef.current = 'none';
          armedActorRef.current = null;
          setArmedActorId(null);
          setStrikeMode('none');
          setActiveTool(tool);
          if (tool === 'select' && rendererRef.current) {
            rendererRef.current.selectedEntityId = null;
            setSelectedEntityId(null);
          }
        }}
        strikeMode={strikeMode}
        armedActorId={armedActorId}
        onToggleAbility={(id) => handleToggleAbility(id)}
        sandboxFaction={sandboxFaction}
        onSelectFaction={setSandboxFaction}
        selectedEntityId={selectedEntityId}
        selectedEntityLabel={
          selectedEntityId
            ? reg.actors[engineRef.current?.entities.get(selectedEntityId)?.actorId ?? '']?.label ?? selectedEntityId
            : null
        }
        selectedEntityScale={selectedEntityScale}
        onChangeSelectedEntityScale={handleChangeSelectedEntityScale}
        activeToolScale={activeTool !== 'select' ? toolScales[activeTool] ?? 1.0 : 1.0}
        onChangeActiveToolScale={(s) => {
          if (activeTool !== 'select') handleChangeToolScale(activeTool, s);
        }}
        aiTopic={aiTopic}
        onChangeAiTopic={setAiTopic}
        onCopyAiPrompt={handleCopyAiPrompt}
        onCopyCatalog={handleCopyCatalog}
        yamlText={yamlText}
        onChangeYaml={(val) => {
          setYamlText(val);
          if (statusNotice) setStatusNotice(null);
        }}
        onApplyYaml={() => void loadScenario(yamlText, 'تم التحقق والتشغيل')}
        onRequestSaveYaml={() => void handleRequestSaveYaml()}
        onUploadYamlFile={handleUploadYamlFile}
        onUploadMapImage={handleUploadMapImage}
        issues={issues}
        yamlSyntaxError={yamlSyntaxError}
        statusNotice={statusNotice}
        onOpenSpec={() => setSpecOpen(true)}
        onSelectActiveMapForBuilder={(id) => void handleSelectActiveMapForBuilder(id)}
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
        onSaveCurrentMap={() => void handleSaveCurrentMap()}
        onCreateStarterScenario={() => void handleCreateStarterScenario()}
        newActorId={newActorId}
        onChangeNewActorId={setNewActorId}
        newActorLabel={newActorLabel}
        onChangeNewActorLabel={setNewActorLabel}
        newActorTpl={newActorTpl}
        onChangeNewActorTpl={setNewActorTpl}
        hasPendingActorImage={Boolean(pendingActorDataUrl)}
        onUploadActorImage={handleUploadActorImage}
        onSaveCustomActor={() => void handleSaveCustomActor()}
        onExportPack={handleExportPack}
        onImportPackFile={handleImportPackFile}
        packNotice={packNotice}
      />
  );

  return (
    <div
      data-testid="studio-root"
      data-playing={String(playing)}
      data-tick={hudState.tick}
      data-entities={hudState.entityCount}
      data-map={activeMap.id}
      data-recording={String(actionRecording)}
      className="relative flex flex-col h-[100dvh] w-full overflow-hidden bg-[#090f1a] text-slate-100 md:mx-auto md:my-4 md:w-[390px] md:h-[844px] md:max-h-[calc(100dvh-2rem)] md:rounded-[2.25rem] md:border-4 md:border-slate-800 md:shadow-2xl"
    >
      {(unitsOpen || toolsOpen) && (
        <div
          className="absolute inset-0 z-30"
          onClick={() => {
            setUnitsOpen(false);
            setToolsOpen(false);
          }}
          aria-hidden="true"
        />
      )}

      {/* Left edge: mechanisms and equipment */}
      <button
        type="button"
        onClick={() => setUnitsOpen(true)}
        aria-label="فتح الآليات والمعدات"
        title="الآليات والمعدات"
        className={`absolute left-0 top-1/2 z-40 -translate-y-1/2 flex h-12 w-9 items-center justify-center rounded-r-lg border border-l-0 border-slate-700 bg-slate-900/95 text-sky-300 shadow-lg transition-opacity ${
          unitsOpen ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}
      >
        <Truck className="w-4 h-4" />
      </button>
      <div
        className={`absolute left-0 top-16 bottom-[4.5rem] z-40 flex w-[min(300px,85%)] flex-col overflow-hidden rounded-r-xl border border-l-0 border-slate-700 bg-slate-900 shadow-2xl transition-transform duration-200 ${
          unitsOpen ? 'translate-x-0' : '-translate-x-full pointer-events-none'
        }`}
        aria-hidden={!unitsOpen}
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800 shrink-0">
          <span className="text-sm font-semibold text-sky-300">الآليات والمعدات</span>
          <button
            type="button"
            onClick={() => setUnitsOpen(false)}
            aria-label="إغلاق الآليات والمعدات"
            className="p-1.5 rounded text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="relative flex-1 min-h-0">
          <div className="absolute inset-0">{renderStudioSidebar('units')}</div>
        </div>
      </div>

      {/* Right edge: tools */}
      <button
        type="button"
        onClick={() => setToolsOpen(true)}
        aria-label="فتح لوحة الأدوات"
        title="لوحة الأدوات"
        className={`absolute right-0 top-1/2 z-40 -translate-y-1/2 flex h-12 w-9 items-center justify-center rounded-l-lg border border-r-0 border-slate-700 bg-slate-900/95 text-sky-300 shadow-lg transition-opacity ${
          toolsOpen ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}
      >
        <Wrench className="w-4 h-4" />
      </button>
      <div
        className={`absolute right-0 top-16 bottom-[4.5rem] z-40 flex w-[min(320px,88%)] flex-col overflow-hidden rounded-l-xl border border-r-0 border-slate-700 bg-slate-900 shadow-2xl transition-transform duration-200 ${
          toolsOpen ? 'translate-x-0' : 'translate-x-full pointer-events-none'
        }`}
        aria-hidden={!toolsOpen}
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800 shrink-0">
          <span className="text-sm font-semibold text-sky-300">لوحة الأدوات</span>
          <button
            type="button"
            onClick={() => setToolsOpen(false)}
            aria-label="إغلاق لوحة الأدوات"
            className="p-1.5 rounded text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="relative flex-1 min-h-0">
          <div className="absolute inset-0">{renderStudioSidebar('tools')}</div>
        </div>
      </div>

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
          <div ref={stageHostRef} className={`w-full h-full ${strikeMode !== 'none' ? 'cursor-crosshair' : ''}`} />

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

              <div className="pointer-events-auto flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => setMapToolsOpen((o) => !o)}
                  aria-expanded={mapToolsOpen}
                  aria-label={mapToolsOpen ? 'طيّ أدوات الخريطة' : 'فتح أدوات الخريطة'}
                  title={mapToolsOpen ? 'طيّ أدوات الخريطة' : 'فتح أدوات الخريطة'}
                  className="p-1.5 rounded-lg bg-slate-950/92 border border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800 shadow-lg transition-colors"
                >
                  {mapToolsOpen ? <X className="w-4 h-4" /> : <Layers className="w-4 h-4" />}
                </button>
                {mapToolsOpen && (
                  <div className="flex items-center gap-0.5 sm:gap-1 bg-slate-950/92 border border-slate-800 rounded-lg p-1 shadow-lg">
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
                )}
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
                {geoHoverText && (
                  <span
                    id="geoHoverLabel"
                    className="bg-slate-900 border border-slate-700 text-slate-200 px-2 py-0.5 rounded truncate max-w-[260px] sm:max-w-[380px]"
                  >
                    {geoHoverText}
                  </span>
                )}
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
                    onClick={() => void openEmptyMapBoard('world_live')}
                    className="px-2.5 py-0.5 font-medium bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-600 rounded whitespace-nowrap shrink-0 transition-colors"
                  >
                    ↩ العودة لخريطة العالم
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Blocked Navigation / Error / Recorder Toast */}
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
          className="bg-slate-900 border-t border-slate-800 px-3 py-2 flex items-center gap-2 text-xs shrink-0"
        >
          <button
            type="button"
            onClick={() => setPlaying((p) => !p)}
            aria-label={playing ? 'إيقاف مؤقت' : 'تشغيل'}
            title={playing ? 'إيقاف مؤقت' : 'تشغيل'}
            className="p-2 rounded-lg bg-sky-600 text-white hover:bg-sky-500 shrink-0"
          >
            {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
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

import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as yaml from 'js-yaml';
import { Eye, EyeOff, Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import { DT, StudioEngine } from './core/engine';
import { Faction, MapPack, Point, ScenarioFile, ValidationIssue } from './core/types';
import { validateScenario } from './core/validator';
import { DEMO_ACTORS, DEMO_MAPS } from './packs/demoPacks';
import { SoundSynth } from './renderer/soundSynth';
import { StudioRenderer } from './renderer/studioRenderer';
import { SpecModal } from './components/SpecModal';
import { PresetOption, SandboxTool, StudioSidebar } from './components/StudioSidebar';
import straitYaml from './scenarios/strait_crisis.scenario.yaml?raw';
import valleyYaml from './scenarios/valley_advance.scenario.yaml?raw';

const SCENARIOS: Record<string, { label: string; yaml: string }> = {
  strait: { label: 'أزمة المضيق (خريطة سياسية)', yaml: straitYaml },
  valley: { label: 'العبور التكتيكي (خريطة ميدان)', yaml: valleyYaml }
};

const PRESET_OPTIONS: PresetOption[] = [
  { key: 'strait', label: SCENARIOS.strait.label },
  { key: 'valley', label: SCENARIOS.valley.label }
];

function formatSimTime(sec: number): string {
  const mins = Math.floor(sec / 60);
  const rem = sec % 60;
  return `${String(mins).padStart(2, '0')}:${rem.toFixed(1).padStart(4, '0')}`;
}

export default function App() {
  const stageHostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<StudioRenderer | null>(null);
  const engineRef = useRef<StudioEngine | null>(null);
  const soundRef = useRef<SoundSynth | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  // Refs synced for 60fps loop without triggering React re-renders
  const playingRef = useRef(true);
  const speedRef = useRef(1);
  const activeToolRef = useRef<SandboxTool>('select');
  const sandboxFactionRef = useRef<Faction>('blue');
  const sandboxCounterRef = useRef(1);

  const [selectedPreset, setSelectedPreset] = useState('strait');
  const [yamlText, setYamlText] = useState(SCENARIOS.strait.yaml);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [muted, setMuted] = useState(false);
  const [recording, setRecording] = useState(false);
  const [activeTool, setActiveTool] = useState<SandboxTool>('select');
  const [sandboxFaction, setSandboxFaction] = useState<Faction>('blue');
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [yamlSyntaxError, setYamlSyntaxError] = useState<string | null>(null);
  const [applySuccessNotice, setApplySuccessNotice] = useState(false);
  const [showAnchors, setShowAnchors] = useState(true);
  const [specOpen, setSpecOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [activeMap, setActiveMap] = useState<MapPack>(DEMO_MAPS.geopolitics_strait);

  // Throttled HUD readouts
  const [hudState, setHudState] = useState({
    simTimeSec: 0,
    tick: 0,
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

  const loadScenario = useCallback(async (rawYaml: string, showSuccess = false) => {
    setIssues([]);
    setYamlSyntaxError(null);
    setApplySuccessNotice(false);

    try {
      const parsed = yaml.load(rawYaml) as ScenarioFile;
      const map = DEMO_MAPS[parsed?.meta?.map];
      const foundIssues = validateScenario(parsed, map, DEMO_ACTORS);
      if (foundIssues.length > 0) {
        setIssues(foundIssues);
        return;
      }

      const engine = new StudioEngine(map, DEMO_ACTORS, parsed);
      if (soundRef.current) {
        engine.onSound((id) => soundRef.current?.play(id));
      }
      engineRef.current = engine;
      setActiveMap(map);
      setSelectedEntityId(null);

      if (rendererRef.current) {
        await rendererRef.current.loadEngineAssets(engine);
      }

      setHudState({
        simTimeSec: 0,
        tick: engine.tick,
        caption: engine.caption,
        entityCount: engine.entities.size,
        executedSteps: engine.executedStepCount,
        totalSteps: engine.totalStepCount
      });

      if (showSuccess) {
        setApplySuccessNotice(true);
      }
    } catch (err) {
      setYamlSyntaxError((err as Error).message);
    }
  }, []);

  // Initialize PixiJS StudioRenderer + 30 TPS deterministic loop once
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

    renderer.onMapClick = (pt: Point, hitId: string | null) => {
      const eng = engineRef.current;
      if (!eng) return;

      const tool = activeToolRef.current;
      if (tool === 'select') {
        if (hitId) {
          renderer.selectedEntityId = hitId;
          setSelectedEntityId(hitId);
        } else if (renderer.selectedEntityId) {
          eng.dispatchOrder({ type: 'move', entityId: renderer.selectedEntityId, to: pt });
        }
      } else {
        const actor = DEMO_ACTORS[tool];
        if (!actor) return;
        const id = `sb_${sandboxCounterRef.current++}`;
        const faction = sandboxFactionRef.current;
        if (actor.kind === 'building') {
          eng.dispatchOrder({ type: 'construct', id, actorId: actor.id, at: pt, faction, durationSec: 1.8 });
        } else {
          eng.dispatchOrder({ type: 'spawn', id, actorId: actor.id, at: pt, faction });
          renderer.selectedEntityId = id;
          setSelectedEntityId(id);
        }
      }
    };

    const boot = async () => {
      await renderer.init(host);
      if (cancelled) return;
      await loadScenario(SCENARIOS.strait.yaml, false);

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
          renderer.render(eng, alpha, now / 1000, frameDt);

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
            setHudState({
              simTimeSec: simSec,
              tick: eng.tick,
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
      renderer.destroy();
    };
  }, [loadScenario]);

  const handleSelectPreset = async (key: string) => {
    setSelectedPreset(key);
    const nextYaml = SCENARIOS[key].yaml;
    setYamlText(nextYaml);
    await loadScenario(nextYaml, false);
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
    setHudState({
      simTimeSec: 0,
      tick: eng.tick,
      caption: eng.caption,
      entityCount: eng.entities.size,
      executedSteps: eng.executedStepCount,
      totalSteps: eng.totalStepCount
    });
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
    await loadScenario(text, true);
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

  const handleStageDrop = async (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    if (file.name.endsWith('.yaml') || file.name.endsWith('.yml')) {
      await handleUploadYamlFile(file);
    } else if (file.type.startsWith('image/')) {
      await handleUploadMapImage(file);
    }
  };

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

    const stream = renderer.app.canvas.captureStream(30);
    const chunks: Blob[] = [];
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm';
    const rec = new MediaRecorder(stream, { mimeType });
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
      a.download = 'scenario-export.webm';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    };

    renderer.hideUIHelpers = true;
    rec.start();
    setRecording(true);
  };

  return (
    <div
      data-testid="studio-root"
      data-playing={String(playing)}
      data-tick={hudState.tick}
      data-entities={hudState.entityCount}
      data-scenario={selectedPreset}
      className="flex flex-col lg:grid lg:grid-cols-[380px_1fr] h-screen w-screen overflow-hidden bg-[#090f1a] text-slate-100"
    >
      <StudioSidebar
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
        activeTool={activeTool}
        onSelectTool={setActiveTool}
        sandboxFaction={sandboxFaction}
        onSelectFaction={setSandboxFaction}
        selectedEntityId={selectedEntityId}
        yamlText={yamlText}
        onChangeYaml={(val) => {
          setYamlText(val);
          if (applySuccessNotice) setApplySuccessNotice(false);
        }}
        onApplyYaml={() => loadScenario(yamlText, true)}
        onUploadYamlFile={handleUploadYamlFile}
        onUploadMapImage={handleUploadMapImage}
        issues={issues}
        yamlSyntaxError={yamlSyntaxError}
        applySuccessNotice={applySuccessNotice}
        onOpenSpec={() => setSpecOpen(true)}
      />

      <main
        className="relative flex-1 min-h-0 h-full overflow-hidden bg-[#090f1a]"
        onDragOver={(e) => {
          e.preventDefault();
          if (!dragActive) setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleStageDrop}
      >
        <div ref={stageHostRef} className="w-full h-full" />

        {/* Unobtrusive Stage Telemetry & Camera Strip */}
        <div className="pointer-events-none absolute top-3 inset-x-3 flex items-center justify-between gap-2 z-10">
          <div className="pointer-events-auto flex items-center gap-2 bg-slate-950/90 border border-slate-800 rounded-lg px-2.5 sm:px-3 py-1.5 text-xs text-slate-300 shadow-lg min-w-0">
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

          <div className="pointer-events-auto flex items-center gap-0.5 sm:gap-1 bg-slate-950/90 border border-slate-800 rounded-lg p-1 shadow-lg shrink-0">
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

        {/* Drag & Drop Overlay */}
        {dragActive && (
          <div className="pointer-events-none absolute inset-4 z-20 flex items-center justify-center rounded-xl border-2 border-dashed border-sky-400 bg-slate-950/85">
            <p className="text-base font-semibold text-sky-300">
              أفلت ملف السيناريو (.yaml) أو صورة الخريطة المخصصة هنا
            </p>
          </div>
        )}

        {/* Cinematic Caption Bar */}
        {hudState.caption && (
          <div
            id="captionBar"
            data-testid="caption-bar"
            className="pointer-events-none absolute bottom-5 left-1/2 -translate-x-1/2 z-10 max-w-[85%] bg-slate-950/92 border border-sky-500/70 px-5 py-2.5 rounded-lg text-sm sm:text-base font-medium text-slate-100 text-center shadow-xl"
          >
            {hudState.caption}
          </div>
        )}
      </main>

      <SpecModal
        open={specOpen}
        onClose={() => setSpecOpen(false)}
        activeMap={activeMap}
        actors={DEMO_ACTORS}
      />
    </div>
  );
}

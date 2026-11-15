import React, { useRef, useState } from 'react';
import {
  BookOpen,
  CheckCircle2,
  ClipboardCopy,
  FileUp,
  ImagePlus,
  Map as MapIcon,
  Pause,
  Play,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
  Video,
  Volume2,
  VolumeX
} from 'lucide-react';
import { ActorPack, Faction, MapPack, SavedScenarioRecord, ValidationIssue } from '../core/types';
import { MapEditTool, PackBuilderPanel } from './PackBuilderPanel';

interface StudioSidebarProps {
  activeTab: 'play' | 'pack';
  onChangeTab: (tab: 'play' | 'pack') => void;
  // Independent map environment + unit scale
  maps: Record<string, MapPack>;
  activeMapId: string;
  onSelectEnvironmentMap: (mapId: string) => void;
  onClearBoard: () => void;
  unitScale: number;
  onChangeUnitScale: (scale: number) => void;
  // Live action recorder
  actionRecording: boolean;
  recClockSec: number;
  recStepCount: number;
  onStartActionRecord: () => void;
  onRequestStopActionRecord: () => void;
  onRecCamera: () => void;
  onRecCaptionSubmit: (text: string) => void;
  onRecZone: () => void;
  onRecArrow: () => void;
  onRecPulse: () => void;
  onRecDeleteUnit: () => void;
  // Inline save prompt (replaces window.prompt for iFrame compatibility)
  pendingSaveMode: 'recorded' | 'code' | null;
  saveDraftTitle: string;
  onChangeSaveDraftTitle: (val: string) => void;
  onConfirmSaveScenario: () => void;
  onCancelSaveScenario: () => void;
  // Saved scenarios database
  scenarios: SavedScenarioRecord[];
  selectedScenarioId: string;
  onSelectScenarioId: (id: string) => void;
  onLoadSelectedScenario: () => void;
  onDeleteSelectedScenario: () => void;
  // Playback transport
  playing: boolean;
  onTogglePlay: () => void;
  onRestart: () => void;
  speed: number;
  onChangeSpeed: (speed: number) => void;
  muted: boolean;
  onToggleMute: () => void;
  recording: boolean;
  onToggleRecord: () => void;
  // Sandbox palette
  actors: Record<string, ActorPack>;
  activeTool: string;
  onSelectTool: (tool: string) => void;
  sandboxFaction: Faction;
  onSelectFaction: (faction: Faction) => void;
  selectedEntityId: string | null;
  // AI & YAML editor
  aiTopic: string;
  onChangeAiTopic: (val: string) => void;
  onCopyAiPrompt: () => void;
  onCopyCatalog: () => void;
  yamlText: string;
  onChangeYaml: (val: string) => void;
  onApplyYaml: () => void;
  onRequestSaveYaml: () => void;
  onUploadYamlFile: (file: File) => void;
  onUploadMapImage: (file: File) => void;
  issues: ValidationIssue[];
  yamlSyntaxError: string | null;
  statusNotice: string | null;
  onOpenSpec: () => void;
  // Pack builder props
  onSelectActiveMapForBuilder: (mapId: string) => void;
  newMapId: string;
  onChangeNewMapId: (val: string) => void;
  onUploadNewMapImage: (file: File) => void;
  mapTool: MapEditTool;
  onSelectMapTool: (tool: MapEditTool) => void;
  pointName: string;
  onChangePointName: (val: string) => void;
  draftZoneCount: number;
  onFinishZone: () => void;
  onClearDraftZone: () => void;
  onSaveCurrentMap: () => void;
  onCreateStarterScenario: () => void;
  newActorId: string;
  onChangeNewActorId: (val: string) => void;
  newActorLabel: string;
  onChangeNewActorLabel: (val: string) => void;
  newActorTpl: string;
  onChangeNewActorTpl: (val: string) => void;
  hasPendingActorImage: boolean;
  onUploadActorImage: (file: File) => void;
  onSaveCustomActor: () => void;
  onExportPack: () => void;
  onImportPackFile: (file: File) => void;
  packNotice: { kind: 'ok' | 'err'; text: string } | null;
}

const FACTION_BUTTONS: Array<{ id: Faction; label: string }> = [
  { id: 'blue', label: 'أزرق' },
  { id: 'red', label: 'أحمر' },
  { id: 'neutral', label: 'محايد' }
];

export function StudioSidebar(props: StudioSidebarProps) {
  const {
    activeTab,
    onChangeTab,
    maps,
    activeMapId,
    onSelectEnvironmentMap,
    onClearBoard,
    unitScale,
    onChangeUnitScale,
    actionRecording,
    recClockSec,
    recStepCount,
    onStartActionRecord,
    onRequestStopActionRecord,
    onRecCamera,
    onRecCaptionSubmit,
    onRecZone,
    onRecArrow,
    onRecPulse,
    onRecDeleteUnit,
    pendingSaveMode,
    saveDraftTitle,
    onChangeSaveDraftTitle,
    onConfirmSaveScenario,
    onCancelSaveScenario,
    scenarios,
    selectedScenarioId,
    onSelectScenarioId,
    onLoadSelectedScenario,
    onDeleteSelectedScenario,
    playing,
    onTogglePlay,
    onRestart,
    speed,
    onChangeSpeed,
    muted,
    onToggleMute,
    recording,
    onToggleRecord,
    actors,
    activeTool,
    onSelectTool,
    sandboxFaction,
    onSelectFaction,
    selectedEntityId,
    aiTopic,
    onChangeAiTopic,
    onCopyAiPrompt,
    onCopyCatalog,
    yamlText,
    onChangeYaml,
    onApplyYaml,
    onRequestSaveYaml,
    onUploadYamlFile,
    onUploadMapImage,
    issues,
    yamlSyntaxError,
    statusNotice,
    onOpenSpec
  } = props;

  const yamlInputRef = useRef<HTMLInputElement>(null);
  const mapInputRef = useRef<HTMLInputElement>(null);
  const [captionInputOpen, setCaptionInputOpen] = useState(false);
  const [captionDraft, setCaptionDraft] = useState('');

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, handler: (f: File) => void) => {
    const file = e.target.files?.[0];
    if (file) handler(file);
    e.target.value = '';
  };

  const handleCaptionSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = captionDraft.trim();
    if (!clean) return;
    onRecCaptionSubmit(clean);
    setCaptionDraft('');
    setCaptionInputOpen(false);
  };

  return (
    <aside
      aria-label="لوحة التحكم وصانع الحزم"
      className="bg-slate-900 border-b lg:border-b-0 lg:border-l border-slate-800 p-3.5 flex flex-col gap-2.5 overflow-y-auto max-h-[48vh] lg:max-h-screen lg:h-screen"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-800">
        <h1 className="text-base font-bold text-sky-400 tracking-wide whitespace-nowrap truncate">
          استوديو السيناريوهات التفاعلي
        </h1>
        <button
          type="button"
          onClick={onOpenSpec}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-md whitespace-nowrap shrink-0 transition-colors focus-visible:outline-2 focus-visible:outline-sky-400"
        >
          <BookOpen className="w-3.5 h-3.5 text-sky-400" />
          <span>دليل YAML</span>
        </button>
      </div>

      {/* Mode Tabs */}
      <div role="tablist" aria-label="أقسام الاستوديو" className="grid grid-cols-2 gap-1.5 bg-slate-950 p-1 rounded-lg border border-slate-800 shrink-0">
        <button
          type="button"
          role="tab"
          id="tabPlay"
          aria-selected={activeTab === 'play'}
          onClick={() => onChangeTab('play')}
          className={`px-2.5 py-1.5 text-xs font-semibold rounded-md whitespace-nowrap transition-colors ${
            activeTab === 'play' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-100'
          }`}
        >
          البيئة والسيناريو
        </button>
        <button
          type="button"
          role="tab"
          id="tabPack"
          aria-selected={activeTab === 'pack'}
          onClick={() => onChangeTab('pack')}
          className={`px-2.5 py-1.5 text-xs font-semibold rounded-md whitespace-nowrap transition-colors ${
            activeTab === 'pack' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-100'
          }`}
        >
          صانع الحزم (خرائط/كيانات)
        </button>
      </div>

      {activeTab === 'play' ? (
        <div id="viewPlay" className="flex flex-col gap-2.5 flex-1 min-h-0">
          {/* 1. Independent Map Environment & Adaptive Scale */}
          <section aria-label="البيئة والخريطة الحالية" className="bg-slate-950/70 border border-slate-800 rounded-lg p-2.5 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-400">
                <MapIcon className="w-3.5 h-3.5 text-sky-400" />
                <span>البيئة / الخريطة الحالية (مستقلة):</span>
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <select
                id="mapSelect"
                aria-label="اختيار البيئة أو الخريطة"
                value={activeMapId}
                onChange={(e) => onSelectEnvironmentMap(e.target.value)}
                className="flex-1 min-w-0 bg-slate-900 text-slate-100 border border-slate-700 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:border-sky-400"
              >
                {Object.values(maps).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                  </option>
                ))}
              </select>
              <button
                type="button"
                id="clearBoardBtn"
                onClick={onClearBoard}
                title="تفريغ الخريطة للعب أو التسجيل الحر"
                className="px-2.5 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 rounded-md whitespace-nowrap shrink-0"
              >
                لوح فارغ
              </button>
            </div>

            <div className="flex items-center gap-2 text-xs pt-0.5">
              <label htmlFor="unitScaleSlider" className="text-[11px] text-slate-400 whitespace-nowrap shrink-0">
                حجم الآليات:
              </label>
              <input
                id="unitScaleSlider"
                type="range"
                min="0.3"
                max="2.0"
                step="0.05"
                value={unitScale}
                onChange={(e) => onChangeUnitScale(parseFloat(e.target.value))}
                className="flex-1 accent-sky-400 cursor-pointer"
              />
              <span id="unitScaleVal" dir="ltr" className="font-mono tabular-nums text-[11px] text-sky-300 w-10 text-left shrink-0">
                {unitScale.toFixed(2)}x
              </span>
            </div>
          </section>

          {/* 2. Live Action Recorder */}
          <section
            id="recorderPanel"
            aria-label="مسجل السيناريو الحي"
            className={`rounded-lg p-2.5 space-y-2 border transition-colors ${
              actionRecording
                ? 'border-red-500 bg-red-950/30'
                : 'border-slate-800 bg-slate-950/70'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-slate-300">مسجل السيناريو بالتحركات اليدوية</span>
              {actionRecording && (
                <span id="recTimer" className="inline-flex items-center gap-1.5 text-[11px] font-mono text-red-200">
                  <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  <b id="recClock">{recClockSec.toFixed(1)}s</b>
                  <span className="text-slate-400">(<span id="recCount">{recStepCount}</span> خطوة)</span>
                </span>
              )}
            </div>

            {!actionRecording ? (
              <button
                type="button"
                id="startActionRecBtn"
                onClick={onStartActionRecord}
                className="w-full px-3 py-1.5 text-xs font-semibold bg-sky-600 hover:bg-sky-500 text-white border border-sky-400 rounded-md transition-colors"
              >
                🔴 بدء تسجيل سيناريو حي
              </button>
            ) : (
              <>
                <button
                  type="button"
                  id="stopActionRecBtn"
                  onClick={() => {
                    setCaptionInputOpen(false);
                    onRequestStopActionRecord();
                  }}
                  className="w-full px-3 py-1.5 text-xs font-semibold bg-red-700 hover:bg-red-600 text-white border border-red-400 rounded-md transition-colors"
                >
                  ⏹ إيقاف وحفظ في السجل
                </button>

                <div id="recQuickActions" className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    id="recCamBtn"
                    onClick={onRecCamera}
                    className="px-2 py-1 text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 rounded whitespace-nowrap"
                  >
                    📷 لقطة كاميرا
                  </button>
                  <button
                    type="button"
                    id="recCaptionBtn"
                    onClick={() => setCaptionInputOpen((v) => !v)}
                    className="px-2 py-1 text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 rounded whitespace-nowrap"
                  >
                    💬 نص شرح
                  </button>
                  <button
                    type="button"
                    id="recZoneBtn"
                    onClick={onRecZone}
                    className="px-2 py-1 text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 rounded whitespace-nowrap"
                  >
                    🎨 تلوين المحددة
                  </button>
                  <button
                    type="button"
                    id="recArrowBtn"
                    onClick={onRecArrow}
                    className="px-2 py-1 text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 rounded whitespace-nowrap"
                  >
                    ↗ رسم سهم
                  </button>
                  <button
                    type="button"
                    id="recPulseBtn"
                    onClick={onRecPulse}
                    className="px-2 py-1 text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 rounded whitespace-nowrap"
                  >
                    📡 نبضة تنبيه
                  </button>
                  <button
                    type="button"
                    id="recDelUnitBtn"
                    onClick={onRecDeleteUnit}
                    disabled={!selectedEntityId}
                    className="px-2 py-1 text-[11px] bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-100 border border-slate-700 rounded whitespace-nowrap"
                  >
                    🗑 حذف المحددة
                  </button>
                </div>

                {captionInputOpen && (
                  <form onSubmit={handleCaptionSubmit} className="flex items-center gap-1.5 pt-1">
                    <input
                      type="text"
                      id="recCaptionInput"
                      value={captionDraft}
                      onChange={(e) => setCaptionDraft(e.target.value)}
                      placeholder="اكتب نص الشرح ليظهر بالأسفل..."
                      aria-label="نص الشرح المسجل"
                      className="flex-1 min-w-0 bg-slate-900 text-slate-100 border border-slate-700 rounded px-2 py-1 text-xs focus:outline-none focus:border-sky-400"
                    />
                    <button
                      type="submit"
                      id="recCaptionConfirmBtn"
                      className="px-2.5 py-1 text-xs font-medium bg-sky-600 hover:bg-sky-500 text-white rounded shrink-0"
                    >
                      إضافة
                    </button>
                  </form>
                )}
              </>
            )}

            {/* Inline Save Title Form (for recorded or code scenarios) */}
            {pendingSaveMode && (
              <div id="saveScenarioDialog" className="bg-slate-900 border border-sky-500/60 rounded-md p-2 space-y-1.5">
                <label htmlFor="saveTitleInput" className="block text-[11px] text-sky-300 font-medium">
                  {pendingSaveMode === 'recorded' ? 'اسم السيناريو المسجّل لحفظه في السجل:' : 'اسم السيناريو لحفظه في قاعدة البيانات:'}
                </label>
                <input
                  type="text"
                  id="saveTitleInput"
                  value={saveDraftTitle}
                  onChange={(e) => onChangeSaveDraftTitle(e.target.value)}
                  className="w-full bg-slate-950 text-slate-100 border border-slate-700 rounded px-2.5 py-1 text-xs focus:outline-none focus:border-sky-400"
                />
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    id="confirmSaveScenarioBtn"
                    onClick={onConfirmSaveScenario}
                    className="flex-1 px-2.5 py-1 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded"
                  >
                    حفظ وإعادة تشغيل
                  </button>
                  <button
                    type="button"
                    id="cancelSaveScenarioBtn"
                    onClick={onCancelSaveScenario}
                    className="px-2.5 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded"
                  >
                    إلغاء
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* 3. Sandbox Palette */}
          <section aria-label="أدوات اللعب الحر" className="bg-slate-950/70 border border-slate-800 rounded-lg p-2.5 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-slate-400">الأدوات والآليات</span>
              <div className="flex items-center gap-1 bg-slate-900 p-0.5 rounded-md border border-slate-800">
                {FACTION_BUTTONS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => onSelectFaction(f.id)}
                    className={`px-2 py-0.5 text-[11px] font-medium rounded whitespace-nowrap shrink-0 transition-colors ${
                      sandboxFaction === f.id
                        ? f.id === 'blue'
                          ? 'bg-sky-600 text-white'
                          : f.id === 'red'
                            ? 'bg-red-600 text-white'
                            : 'bg-slate-600 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <div id="sandboxBar" className="flex flex-wrap gap-1.5">
              <button
                type="button"
                data-tool="select"
                onClick={() => onSelectTool('select')}
                className={`px-2.5 py-1 text-xs font-medium rounded-md border whitespace-nowrap shrink-0 transition-colors ${
                  activeTool === 'select'
                    ? 'bg-sky-600 border-sky-400 text-white'
                    : 'bg-slate-900 border-slate-700 text-slate-200 hover:bg-slate-800'
                }`}
              >
                تحديد / تحريك
              </button>
              {Object.values(actors).map((act) => (
                <button
                  key={act.id}
                  type="button"
                  data-tool={act.id}
                  onClick={() => onSelectTool(act.id)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md border whitespace-nowrap shrink-0 transition-colors ${
                    activeTool === act.id
                      ? 'bg-sky-600 border-sky-400 text-white'
                      : 'bg-slate-900 border-slate-700 text-slate-200 hover:bg-slate-800'
                  }`}
                >
                  + {act.label}
                </button>
              ))}
            </div>

            <p className="text-[11px] text-slate-400 leading-4">
              {activeTool === 'select'
                ? selectedEntityId
                  ? `الوحدة المحددة: ${selectedEntityId} — اضغط على الوجهة للتحريك عبر A*`
                  : 'اضغط على أي وحدة لتحديدها، أو اضغط على أي دولة لتحديدها.'
                : 'اضغط على الخريطة لوضع الكيان المختار مباشرة.'}
            </p>
          </section>

          {/* 4. Saved Scenarios Registry (IndexedDB) + Playback Controls */}
          <section aria-label="سجل السيناريوهات والتحكم" className="bg-slate-950/70 border border-slate-800 rounded-lg p-2.5 space-y-2">
            <span className="block text-[11px] font-medium text-slate-400">
              سجل السيناريوهات المحفوظة (IndexedDB):
            </span>
            <div className="flex items-center gap-1.5">
              <select
                id="scenarioSelect"
                aria-label="سجل السيناريوهات المحفوظة"
                value={selectedScenarioId}
                onChange={(e) => onSelectScenarioId(e.target.value)}
                className="flex-1 min-w-0 bg-slate-900 text-slate-100 border border-slate-700 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:border-sky-400"
              >
                {scenarios.map((s) => {
                  const tag = s.source === 'recorded' ? '[مسجّل] ' : s.source === 'code' ? '[محفوظ] ' : '';
                  const mapTitle = maps[s.mapId]?.title ?? s.mapId;
                  return (
                    <option key={s.id} value={s.id}>
                      {`${tag}${s.title} (${mapTitle})`}
                    </option>
                  );
                })}
              </select>
              <button
                type="button"
                id="loadScenarioBtn"
                onClick={onLoadSelectedScenario}
                className="px-2.5 py-1.5 text-xs font-semibold bg-sky-600 hover:bg-sky-500 text-white border border-sky-400 rounded-md whitespace-nowrap shrink-0"
              >
                تشغيل
              </button>
              <button
                type="button"
                id="delScenarioBtn"
                aria-label="حذف السيناريو المحدد"
                title="حذف السيناريو المحدد"
                onClick={onDeleteSelectedScenario}
                disabled={!selectedScenarioId}
                className="p-1.5 text-xs bg-slate-800 hover:bg-red-900/70 disabled:opacity-40 text-slate-300 hover:text-red-200 border border-slate-700 rounded-md shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                id="playBtn"
                onClick={onTogglePlay}
                className={`inline-flex items-center justify-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md border whitespace-nowrap shrink-0 transition-colors ${
                  playing
                    ? 'bg-sky-600 border-sky-400 text-white hover:bg-sky-500'
                    : 'bg-slate-800 border-slate-700 text-slate-100 hover:bg-slate-700'
                }`}
              >
                {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                <span>{playing ? 'إيقاف مؤقت' : 'تشغيل'}</span>
              </button>

              <button
                type="button"
                id="restartBtn"
                onClick={onRestart}
                className="inline-flex items-center justify-center gap-1 px-2 py-1 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 rounded-md whitespace-nowrap shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>إعادة</span>
              </button>

              <select
                id="speedSelect"
                aria-label="سرعة المحاكاة"
                value={String(speed)}
                onChange={(e) => onChangeSpeed(parseFloat(e.target.value))}
                className="bg-slate-800 text-slate-100 border border-slate-700 rounded-md px-2 py-1 text-xs font-mono tabular-nums focus:outline-none focus:border-sky-400"
              >
                <option value="0.5">0.5x</option>
                <option value="1">1x</option>
                <option value="2">2x</option>
              </select>

              <button
                type="button"
                onClick={onToggleMute}
                aria-label={muted ? 'تفعيل الصوت' : 'كتم الصوت'}
                title={muted ? 'تفعيل الصوت' : 'كتم الصوت'}
                className="inline-flex items-center justify-center p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-md shrink-0"
              >
                {muted ? <VolumeX className="w-3.5 h-3.5 text-slate-400" /> : <Volume2 className="w-3.5 h-3.5 text-sky-400" />}
              </button>

              <button
                type="button"
                id="recBtn"
                onClick={onToggleRecord}
                className={`inline-flex items-center justify-center gap-1 px-2 py-1 text-xs font-medium rounded-md border whitespace-nowrap shrink-0 transition-colors ${
                  recording
                    ? 'bg-red-800 border-red-500 text-white hover:bg-red-700'
                    : 'bg-slate-800 border-slate-700 text-slate-100 hover:bg-slate-700'
                }`}
              >
                <Video className="w-3.5 h-3.5" />
                <span>{recording ? 'إيقاف وحفظ' : 'فيديو WebM'}</span>
              </button>
            </div>
          </section>

          {/* 5. AI Prompt & Live YAML Editor */}
          <section aria-label="الذكاء الاصطناعي ومحرر السيناريو" className="flex-1 flex flex-col gap-2 min-h-[210px]">
            <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-2 space-y-1.5">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-300">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span>تجهيز الذكاء الاصطناعي على هذه الخريطة</span>
              </span>
              <input
                type="text"
                id="aiTopic"
                value={aiTopic}
                onChange={(e) => onChangeAiTopic(e.target.value)}
                placeholder="موضوع السيناريو للذكاء الاصطناعي..."
                aria-label="موضوع السيناريو للذكاء الاصطناعي"
                className="w-full bg-slate-900 text-slate-100 border border-slate-700 rounded-md px-2.5 py-1 text-xs focus:outline-none focus:border-sky-400"
              />
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  id="copyPromptBtn"
                  onClick={onCopyAiPrompt}
                  className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1 text-[11px] font-medium bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 rounded-md whitespace-nowrap"
                >
                  <ClipboardCopy className="w-3 h-3 text-sky-400" />
                  <span>نسخ Prompt للـ AI</span>
                </button>
                <button
                  type="button"
                  id="copyCatalogBtn"
                  onClick={onCopyCatalog}
                  className="inline-flex items-center justify-center gap-1 px-2 py-1 text-[11px] font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-md whitespace-nowrap shrink-0"
                >
                  <span>نسخ CATALOG.md</span>
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2">
              <label htmlFor="yamlEditor" className="text-xs font-medium text-slate-400">
                محرر السيناريو (YAML)
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  ref={yamlInputRef}
                  type="file"
                  accept=".yaml,.yml"
                  className="hidden"
                  onChange={(e) => handleFileChange(e, onUploadYamlFile)}
                />
                <input
                  ref={mapInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handleFileChange(e, onUploadMapImage)}
                />
                <button
                  type="button"
                  onClick={() => yamlInputRef.current?.click()}
                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded whitespace-nowrap shrink-0"
                >
                  <FileUp className="w-3 h-3" />
                  <span>ملف YAML</span>
                </button>
                <button
                  type="button"
                  onClick={() => mapInputRef.current?.click()}
                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded whitespace-nowrap shrink-0"
                >
                  <ImagePlus className="w-3 h-3" />
                  <span>صورة خلفية</span>
                </button>
              </div>
            </div>

            <textarea
              id="yamlEditor"
              dir="ltr"
              spellCheck={false}
              value={yamlText}
              onChange={(e) => onChangeYaml(e.target.value)}
              className="w-full flex-1 min-h-[145px] bg-slate-950 text-cyan-200 border border-slate-700 rounded-md p-2.5 font-mono text-xs leading-5 resize-y [direction:ltr] text-left focus:outline-none focus:border-sky-400"
            />

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                id="applyBtn"
                onClick={onApplyYaml}
                className="flex-1 px-3 py-1.5 text-xs font-semibold bg-sky-600 hover:bg-sky-500 text-white border border-sky-400 rounded-md whitespace-nowrap transition-colors"
              >
                تطبيق الكود
              </button>
              <button
                type="button"
                id="saveYamlBtn"
                onClick={onRequestSaveYaml}
                className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-1.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 rounded-md whitespace-nowrap transition-colors"
              >
                <Save className="w-3.5 h-3.5 text-emerald-400" />
                <span>حفظ في السجل</span>
              </button>
            </div>

            {statusNotice && issues.length === 0 && !yamlSyntaxError && (
              <span id="statusBox" className="inline-flex items-center gap-1 text-xs text-emerald-400 truncate">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{statusNotice}</span>
              </span>
            )}

            {(yamlSyntaxError || issues.length > 0) && (
              <div
                id="errorBox"
                role="alert"
                className="bg-red-950/85 border border-red-600/80 text-red-200 rounded-md p-2.5 text-xs leading-5 space-y-1.5"
              >
                {yamlSyntaxError && (
                  <div className="space-y-1">
                    <div className="font-semibold">خطأ في صياغة YAML:</div>
                    <pre dir="ltr" className="font-mono text-[11px] whitespace-pre-wrap overflow-x-auto text-red-200/95">
                      {yamlSyntaxError}
                    </pre>
                  </div>
                )}
                {issues.map((issue, i) => (
                  <div key={`${issue.stepIndex}-${issue.field}-${i}`}>
                    • [{issue.field}] {issue.message}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      ) : (
        <PackBuilderPanel
          maps={props.maps}
          activeMapId={props.activeMapId}
          onSelectActiveMap={props.onSelectActiveMapForBuilder}
          newMapId={props.newMapId}
          onChangeNewMapId={props.onChangeNewMapId}
          onUploadNewMapImage={props.onUploadNewMapImage}
          mapTool={props.mapTool}
          onSelectMapTool={props.onSelectMapTool}
          pointName={props.pointName}
          onChangePointName={props.onChangePointName}
          draftZoneCount={props.draftZoneCount}
          onFinishZone={props.onFinishZone}
          onClearDraftZone={props.onClearDraftZone}
          onSaveCurrentMap={props.onSaveCurrentMap}
          onCreateStarterScenario={props.onCreateStarterScenario}
          newActorId={props.newActorId}
          onChangeNewActorId={props.onChangeNewActorId}
          newActorLabel={props.newActorLabel}
          onChangeNewActorLabel={props.onChangeNewActorLabel}
          newActorTpl={props.newActorTpl}
          onChangeNewActorTpl={props.onChangeNewActorTpl}
          hasPendingActorImage={props.hasPendingActorImage}
          onUploadActorImage={props.onUploadActorImage}
          onSaveCustomActor={props.onSaveCustomActor}
          onExportPack={props.onExportPack}
          onImportPackFile={props.onImportPackFile}
          packNotice={props.packNotice}
        />
      )}
    </aside>
  );
}

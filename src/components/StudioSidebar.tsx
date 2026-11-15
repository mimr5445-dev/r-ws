import React, { useRef } from 'react';
import {
  BookOpen,
  CheckCircle2,
  ClipboardCopy,
  FileUp,
  ImagePlus,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Video,
  Volume2,
  VolumeX
} from 'lucide-react';
import { ActorPack, Faction, MapPack, ValidationIssue } from '../core/types';
import { MapEditTool, PackBuilderPanel } from './PackBuilderPanel';

export interface PresetOption {
  key: string;
  label: string;
}

interface StudioSidebarProps {
  activeTab: 'play' | 'pack';
  onChangeTab: (tab: 'play' | 'pack') => void;
  presets: PresetOption[];
  selectedPreset: string;
  onSelectPreset: (key: string) => void;
  playing: boolean;
  onTogglePlay: () => void;
  onRestart: () => void;
  speed: number;
  onChangeSpeed: (speed: number) => void;
  muted: boolean;
  onToggleMute: () => void;
  recording: boolean;
  onToggleRecord: () => void;
  actors: Record<string, ActorPack>;
  activeTool: string;
  onSelectTool: (tool: string) => void;
  sandboxFaction: Faction;
  onSelectFaction: (faction: Faction) => void;
  selectedEntityId: string | null;
  aiTopic: string;
  onChangeAiTopic: (val: string) => void;
  onCopyAiPrompt: () => void;
  onCopyCatalog: () => void;
  yamlText: string;
  onChangeYaml: (val: string) => void;
  onApplyYaml: () => void;
  onUploadYamlFile: (file: File) => void;
  onUploadMapImage: (file: File) => void;
  issues: ValidationIssue[];
  yamlSyntaxError: string | null;
  statusNotice: string | null;
  onOpenSpec: () => void;
  // Pack builder props
  maps: Record<string, MapPack>;
  activeMapId: string;
  onSelectActiveMap: (mapId: string) => void;
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
    presets,
    selectedPreset,
    onSelectPreset,
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
    onUploadYamlFile,
    onUploadMapImage,
    issues,
    yamlSyntaxError,
    statusNotice,
    onOpenSpec
  } = props;

  const yamlInputRef = useRef<HTMLInputElement>(null);
  const mapInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, handler: (f: File) => void) => {
    const file = e.target.files?.[0];
    if (file) handler(file);
    e.target.value = '';
  };

  return (
    <aside
      aria-label="لوحة التحكم وصانع الحزم"
      className="bg-slate-900 border-b lg:border-b-0 lg:border-l border-slate-800 p-3.5 flex flex-col gap-3 overflow-y-auto max-h-[46vh] lg:max-h-screen lg:h-screen"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-slate-800">
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
      <div role="tablist" aria-label="أقسام الاستوديو" className="grid grid-cols-2 gap-1.5 bg-slate-950 p-1 rounded-lg border border-slate-800">
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
          المشغّل والسيناريو
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
        <div id="viewPlay" className="flex flex-col gap-3 flex-1 min-h-0">
          {/* Preset & Transport */}
          <section aria-label="التحكم في التشغيل" className="space-y-2">
            <select
              id="presetSelect"
              aria-label="السيناريو الجاهز"
              value={selectedPreset}
              onChange={(e) => onSelectPreset(e.target.value)}
              className="w-full bg-slate-950 text-slate-100 border border-slate-700 rounded-md px-3 py-1.5 text-xs focus:outline-none focus:border-sky-400"
            >
              {presets.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                id="playBtn"
                onClick={onTogglePlay}
                className={`inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border whitespace-nowrap shrink-0 transition-colors focus-visible:outline-2 focus-visible:outline-sky-400 ${
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
                className="inline-flex items-center justify-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 rounded-md whitespace-nowrap shrink-0 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>إعادة</span>
              </button>

              <select
                id="speedSelect"
                aria-label="سرعة المحاكاة"
                value={String(speed)}
                onChange={(e) => onChangeSpeed(parseFloat(e.target.value))}
                className="bg-slate-800 text-slate-100 border border-slate-700 rounded-md px-2 py-1.5 text-xs font-mono tabular-nums focus:outline-none focus:border-sky-400"
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
                {muted ? <VolumeX className="w-4 h-4 text-slate-400" /> : <Volume2 className="w-4 h-4 text-sky-400" />}
              </button>

              <button
                type="button"
                id="recBtn"
                onClick={onToggleRecord}
                className={`inline-flex items-center justify-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border whitespace-nowrap shrink-0 transition-colors ${
                  recording
                    ? 'bg-red-800 border-red-500 text-white hover:bg-red-700'
                    : 'bg-slate-800 border-slate-700 text-slate-100 hover:bg-slate-700'
                }`}
              >
                <Video className="w-3.5 h-3.5" />
                <span>{recording ? 'إيقاف وحفظ' : 'تسجيل فيديو'}</span>
              </button>
            </div>
          </section>

          {/* Sandbox Palette */}
          <section aria-label="أدوات اللعب الحر" className="bg-slate-950/70 border border-slate-800 rounded-lg p-2.5 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-400">وضع اللعب الحر</span>
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
                  ? `الوحدة المحددة: ${selectedEntityId} — اضغط على الخريطة للتحريك عبر A*`
                  : 'اضغط على أي وحدة لتحديدها، ثم اضغط على الوجهة لإصدار أمر حركة.'
                : 'اضغط على الخريطة لوضع الكيان المختار مباشرة.'}
            </p>
          </section>

          {/* AI Prompt & Catalog Generator */}
          <section aria-label="تجهيز نموذج الذكاء الاصطناعي" className="bg-slate-950/70 border border-slate-800 rounded-lg p-2.5 space-y-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-300">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>تجهيز نموذج الذكاء الاصطناعي (CATALOG + Prompt)</span>
            </span>
            <input
              type="text"
              id="aiTopic"
              value={aiTopic}
              onChange={(e) => onChangeAiTopic(e.target.value)}
              placeholder="موضوع السيناريو (مثال: حصار مضيق وإمداد)"
              aria-label="موضوع السيناريو للذكاء الاصطناعي"
              className="w-full bg-slate-900 text-slate-100 border border-slate-700 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:border-sky-400"
            />
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                id="copyPromptBtn"
                onClick={onCopyAiPrompt}
                className="flex-1 inline-flex items-center justify-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 rounded-md whitespace-nowrap"
              >
                <ClipboardCopy className="w-3.5 h-3.5 text-sky-400" />
                <span>نسخ Prompt للـ AI</span>
              </button>
              <button
                type="button"
                id="copyCatalogBtn"
                onClick={onCopyCatalog}
                className="inline-flex items-center justify-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-md whitespace-nowrap shrink-0"
              >
                <span>نسخ CATALOG.md</span>
              </button>
            </div>
          </section>

          {/* Live YAML Editor */}
          <section aria-label="محرر السيناريو" className="flex-1 flex flex-col gap-2 min-h-[190px]">
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
              className="w-full flex-1 min-h-[175px] bg-slate-950 text-cyan-200 border border-slate-700 rounded-md p-2.5 font-mono text-xs leading-5 resize-y [direction:ltr] text-left focus:outline-none focus:border-sky-400"
            />

            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                id="applyBtn"
                onClick={onApplyYaml}
                className="px-3.5 py-1.5 text-xs font-semibold bg-sky-600 hover:bg-sky-500 text-white border border-sky-400 rounded-md whitespace-nowrap shrink-0 transition-colors"
              >
                تطبيق وفحص السيناريو
              </button>

              {statusNotice && issues.length === 0 && !yamlSyntaxError && (
                <span id="statusBox" className="inline-flex items-center gap-1 text-xs text-emerald-400 truncate">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{statusNotice}</span>
                </span>
              )}
            </div>

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
          onSelectActiveMap={props.onSelectActiveMap}
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

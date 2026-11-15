import { X } from 'lucide-react';
import { ActorPack, MapPack } from '../core/types';

interface SpecModalProps {
  open: boolean;
  onClose: () => void;
  activeMap: MapPack;
  actors: Record<string, ActorPack>;
}

export function SpecModal({ open, onClose, activeMap, actors }: SpecModalProps) {
  if (!open) return null;

  const anchorEntries = Object.entries(activeMap.anchors);
  const zoneEntries = Object.entries(activeMap.zones);
  const actorEntries = Object.values(actors);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="spec-modal-title"
    >
      <div className="w-full max-w-2xl max-h-[85vh] flex flex-col bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <h2 id="spec-modal-title" className="text-base font-semibold text-sky-400">
            مرجع لغة السيناريو (YAML DSL v0.1)
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق الدليل"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-sky-400"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-5 text-sm leading-relaxed text-slate-300">
          <p className="text-slate-300">
            استخدم أسماء المراسي (<code className="text-sky-300">anchors</code>) والمناطق (
            <code className="text-sky-300">zones</code>) المعرّفة في الخريطة النشطة بدلًا من إحداثيات البكسل العشوائية. كل خطوة في{' '}
            <code className="text-sky-300">timeline</code> تبدأ بـ <code className="text-amber-300">at: &quot;&lt;sec&gt;s&quot;</code> أو{' '}
            <code className="text-amber-300">after: &quot;&lt;entity_id&gt;.arrived&quot;</code>.
          </p>

          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-slate-400">الأوامر المتاحة</h3>
            <pre
              dir="ltr"
              className="bg-slate-950 border border-slate-800 rounded-lg p-3.5 text-xs text-cyan-200 overflow-x-auto leading-6"
            >{`camera:     { focus: "<anchor_id>", zoom: 1.35, duration?: "1.2s" }
caption:    { text: "نص التعليق السفلي" }
sound:      "build_complete" | "alert_ping" | "move_order" | "spawn_pop"
spawn:      [{ id, actor, at: "<anchor_id>", faction?: "blue"|"red"|"neutral" }]
move:       { entity: "<entity_id>", to: "<anchor_id>" }
construct:  { id?, actor: "<building_actor>", at: "<anchor_id>", faction?, duration?: "2s" }
draw_arrow: { id, from: "<anchor_id>", to: "<anchor_id>", color?: "#hex", dashed?: true, duration?: "1.5s" }
zone:       { id: "<zone_id>", color: "#hex", opacity?: 0.35, duration?: "1.2s" }`}</pre>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-slate-400">
                مراسي الخريطة الحالية ({activeMap.id})
              </h3>
              <ul className="space-y-1 bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs">
                {anchorEntries.map(([id, pt]) => (
                  <li key={id} className="flex items-center justify-between gap-2 py-1 border-b border-slate-900 last:border-0">
                    <code dir="ltr" className="text-amber-300">{id}</code>
                    <span className="text-slate-400">{pt.label ?? id}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-slate-400">مناطق الخريطة ({activeMap.id})</h3>
                <ul className="space-y-1 bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs">
                  {zoneEntries.map(([id, z]) => (
                    <li key={id} className="flex items-center justify-between gap-2 py-1 border-b border-slate-900 last:border-0">
                      <code dir="ltr" className="text-emerald-300">{id}</code>
                      <span className="text-slate-400">{z.label}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-slate-400">الكيانات وقوالب الوراثة</h3>
                <ul className="space-y-1 bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs">
                  {actorEntries.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-2 py-1 border-b border-slate-900 last:border-0">
                      <code dir="ltr" className="text-sky-300">{a.id}</code>
                      <span className="text-slate-400">
                        {a.label} · {a.extends}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

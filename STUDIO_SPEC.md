# Studio Scenario DSL Spec (v0.2)

اكتب ملفات `.scenario.yaml` بهذه البنية فقط. استخدم أسماء المراسي (`anchors`) والمناطق (`zones`) والكيانات (`actors`) الموجودة في الفهرس المرفق (`CATALOG.md`).

## الهيكل الأساسي
- `meta`: `{ title, map }`
- `timeline`: قائمة خطوات، كل خطوة تملك `at: "<sec>s"` أو `after: "<entity_id>.arrived"`

## الأوامر المتاحة داخل كل خطوة
- `camera`: `{ focus: "<anchor_id>", zoom: number, duration?: "<sec>s" }`
- `caption`: `{ text: string }`
- `sound`: `"build_complete" | "alert_ping" | "move_order" | "spawn_pop"`
- `spawn`: `[{ id, actor, at: "<anchor_id>", faction?: "blue"|"red"|"neutral" }]`
- `move`: `{ entity: "<entity_id>", to: "<anchor_id>" }`
- `construct`: `{ id?: string, actor: "<building_actor>", at: "<anchor_id>", faction?, duration?: "<sec>s" }`
- `remove`: `{ entity: "<entity_id>" }`
- `draw_arrow`: `{ id, from: "<anchor_id>", to: "<anchor_id>", color?: "#hex", dashed?: boolean, duration?: "<sec>s" }`
- `zone`: `{ id: "<zone_id>", color: "#hex", opacity?: number, duration?: "<sec>s" }`
- `callout`: `{ id, target: "<entity_id | anchor_id>", text: string, color?: "#hex", duration?: "<sec>s" }`
- `pulse`: `{ at: "<anchor_id>", color?: "#hex", radius?: number }`

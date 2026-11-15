# Studio Scenario DSL Spec (v0.1)

اكتب ملفات `.scenario.yaml` بهذه البنية فقط. لا تستخدم إحداثيات بكسل عشوائية؛ استخدم أسماء المراسي (`anchors`) والمناطق (`zones`) الموجودة في الخريطة.

## الهيكل الأساسي
- `meta`: `{ title, map, duration_hint? }`
- `timeline`: قائمة خطوات، كل خطوة تملك إما `at: "<sec>s"` أو `after: "<entity_id>.arrived"`

## الأوامر المتاحة داخل كل خطوة
- `camera`: `{ focus: "<anchor_id>", zoom: number, duration?: "<sec>s" }`
- `caption`: `{ text: string }`
- `sound`: `"build_complete" | "alert_ping" | "move_order" | "spawn_pop"`
- `spawn`: قائمة `[{ id, actor, at: "<anchor_id>", faction?: "blue"|"red"|"neutral" }]`
- `move`: `{ entity: "<entity_id>", to: "<anchor_id>" }`
- `construct`: `{ id?: string, actor: "<building_actor>", at: "<anchor_id>", faction?, duration?: "<sec>s" }`
- `draw_arrow`: `{ id, from: "<anchor_id>", to: "<anchor_id>", color?: "#hex", dashed?: boolean, duration?: "<sec>s" }`
- `zone`: `{ id: "<zone_id>", color: "#hex", opacity?: number, duration?: "<sec>s" }`

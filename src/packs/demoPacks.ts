import { ActorPack, ActorTemplate, MapPack, NavCell } from '../core/types';

// قوالب الميراث (مثل _templates في Rusted Warfare)
export const TEMPLATES: Record<string, ActorTemplate> = {
  _person: { domain: 'land', kind: 'person', speed: 65, turnRate: 10, scale: 34, radius: 14 },
  _vehicle: { domain: 'land', kind: 'vehicle', speed: 95, turnRate: 4.5, scale: 42, radius: 20 },
  _ship: { domain: 'sea', kind: 'ship', speed: 85, turnRate: 2.6, scale: 50, radius: 22 },
  _building: { domain: 'land', kind: 'building', speed: 0, turnRate: 0, scale: 48, radius: 24 }
};

function defineActor(
  id: string,
  label: string,
  templateName: keyof typeof TEMPLATES,
  overrides: Partial<ActorTemplate>,
  svg: string
): ActorPack {
  return { id, label, extends: templateName, ...TEMPLATES[templateName], ...overrides, svg };
}

export const DEMO_ACTORS: Record<string, ActorPack> = {
  diplomat_person: defineActor(
    'diplomat_person',
    'مبعوث / شخصية',
    '_person',
    { speed: 58 },
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
      <circle cx="32" cy="18" r="10" fill="#fde68a" stroke="#1e293b" stroke-width="3"/>
      <path d="M16 56 C16 38 48 38 48 56 Z" fill="#38bdf8" stroke="#0f172a" stroke-width="3"/>
      <path d="M29 36 L32 50 L35 36 Z" fill="#ef4444"/>
    </svg>`
  ),
  infantry_squad: defineActor(
    'infantry_squad',
    'فصيل مشاة',
    '_person',
    { speed: 68 },
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
      <circle cx="32" cy="18" r="10" fill="#86efac" stroke="#14532d" stroke-width="3"/>
      <path d="M18 54 L22 34 L42 34 L46 54 Z" fill="#22c55e" stroke="#14532d" stroke-width="3"/>
      <rect x="42" y="26" width="16" height="5" rx="2" fill="#1e293b"/>
    </svg>`
  ),
  heavy_tank: defineActor(
    'heavy_tank',
    'دبابة ثقيلة',
    '_vehicle',
    { speed: 82 },
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
      <rect x="10" y="14" width="44" height="36" rx="6" fill="#475569" stroke="#0f172a" stroke-width="3"/>
      <rect x="14" y="10" width="36" height="7" rx="2" fill="#1e293b"/>
      <rect x="14" y="47" width="36" height="7" rx="2" fill="#1e293b"/>
      <circle cx="30" cy="32" r="11" fill="#64748b" stroke="#0f172a" stroke-width="3"/>
      <rect x="34" y="29" width="26" height="6" rx="2" fill="#94a3b8" stroke="#0f172a" stroke-width="2"/>
    </svg>`
  ),
  naval_corvette: defineActor(
    'naval_corvette',
    'فرقاطة بحرية',
    '_ship',
    { speed: 92 },
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
      <path d="M8 22 L46 20 L60 32 L46 44 L8 42 Z" fill="#cbd5e1" stroke="#0f172a" stroke-width="3"/>
      <rect x="20" y="25" width="18" height="14" rx="2" fill="#3b82f6" stroke="#0f172a" stroke-width="2"/>
      <circle cx="44" cy="32" r="4" fill="#ef4444"/>
    </svg>`
  ),
  radar_outpost: defineActor(
    'radar_outpost',
    'محطة رادار',
    '_building',
    {},
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
      <rect x="12" y="12" width="40" height="40" rx="6" fill="#334155" stroke="#0f172a" stroke-width="3"/>
      <circle cx="32" cy="32" r="14" fill="#0ea5e9" stroke="#e0f2fe" stroke-width="3"/>
      <line x1="32" y1="32" x2="43" y2="21" stroke="#fef08a" stroke-width="3"/>
    </svg>`
  ),
  supply_depot: defineActor(
    'supply_depot',
    'مستودع إمداد',
    '_building',
    {},
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
      <rect x="10" y="14" width="44" height="36" rx="4" fill="#b45309" stroke="#451a03" stroke-width="3"/>
      <rect x="18" y="22" width="12" height="20" fill="#fde68a"/>
      <rect x="34" y="22" width="12" height="20" fill="#fde68a"/>
    </svg>`
  )
};

function buildStraitMap(): MapPack {
  const width = 1200;
  const height = 800;
  const cellSize = 20;
  const cols = width / cellSize;
  const rows = height / cellSize;
  const navGrid: NavCell[] = new Array(cols * rows).fill(0);

  // ممر بحري (ماء = 1) ينحني حول شبه الجزيرة في المنتصف
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const wx = x * cellSize + 10;
      const wy = y * cellSize + 10;
      const inWestSea = wx < 420 && wy > 320;
      const inStrait = wx >= 380 && wx <= 820 && wy > 460 && wy < 640;
      const inEastSea = wx > 780 && wy > 250;
      if (inWestSea || inStrait || inEastSea) navGrid[y * cols + x] = 1;
    }
  }

  const svgOrUrl = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800">
    <defs>
      <pattern id="gridStrait" width="60" height="60" patternUnits="userSpaceOnUse">
        <path d="M 60 0 L 0 0 0 60" fill="none" stroke="#94a3b8" stroke-width="0.6" opacity="0.14"/>
      </pattern>
    </defs>
    <rect width="1200" height="800" fill="#1b2636"/>
    <path d="M0,320 L420,320 L420,460 L780,460 L780,250 L1200,250 L1200,800 L0,800 Z" fill="#0b2842"/>
    <path d="M380,640 L820,640 L820,800 L380,800 Z" fill="#253344"/>
    <rect width="1200" height="800" fill="url(#gridStrait)"/>
    <path d="M0,320 L420,320 L420,460 L780,460 L780,250 L1200,250" fill="none" stroke="#38bdf8" stroke-width="3" opacity="0.55"/>
    <path d="M380,800 L380,640 L820,640 L820,800" fill="none" stroke="#38bdf8" stroke-width="2.5" opacity="0.45"/>
    <line x1="220" y1="0" x2="280" y2="320" stroke="#64748b" stroke-width="2.5" stroke-dasharray="10 8"/>
    <line x1="650" y1="0" x2="620" y2="460" stroke="#64748b" stroke-width="2.5" stroke-dasharray="10 8"/>
    <text x="150" y="130" fill="#94a3b8" font-size="22" font-family="IBM Plex Sans Arabic, system-ui, sans-serif">الإقليم الغربي</text>
    <text x="510" y="130" fill="#94a3b8" font-size="22" font-family="IBM Plex Sans Arabic, system-ui, sans-serif">شبه الجزيرة</text>
    <text x="950" y="130" fill="#94a3b8" font-size="22" font-family="IBM Plex Sans Arabic, system-ui, sans-serif">الساحل الشرقي</text>
    <text x="540" y="560" fill="#38bdf8" font-size="20" font-family="IBM Plex Sans Arabic, system-ui, sans-serif" opacity="0.75">المضيق البحري</text>
  </svg>`;

  return {
    id: 'geopolitics_strait',
    title: 'خريطة سياسية: المضيق البحري',
    kind: 'geopolitical',
    width,
    height,
    cellSize,
    cols,
    rows,
    navGrid,
    svgOrUrl,
    anchors: {
      capital_north: { x: 180, y: 200, label: 'العاصمة' },
      peninsula_center: { x: 560, y: 280, label: 'وسط الجزيرة' },
      coast_point_1: { x: 580, y: 420, label: 'نقطة المراقبة' },
      port_south: { x: 180, y: 540, label: 'الميناء الغربي' },
      strait_gate: { x: 600, y: 550, label: 'بوابة المضيق' },
      port_east: { x: 1020, y: 420, label: 'الميناء الشرقي' }
    },
    zones: {
      corridor_south: {
        id: 'corridor_south',
        label: 'ممر المضيق',
        polygon: [
          { x: 400, y: 470 },
          { x: 800, y: 470 },
          { x: 800, y: 635 },
          { x: 400, y: 635 }
        ]
      },
      north_sector: {
        id: 'north_sector',
        label: 'الإقليم الشمالي',
        polygon: [
          { x: 260, y: 40 },
          { x: 630, y: 40 },
          { x: 615, y: 450 },
          { x: 425, y: 450 },
          { x: 425, y: 310 },
          { x: 280, y: 310 }
        ]
      }
    }
  };
}

function buildValleyMap(): MapPack {
  const width = 1200;
  const height = 800;
  const cellSize = 20;
  const cols = width / cellSize;
  const rows = height / cellSize;
  const navGrid: NavCell[] = new Array(cols * rows).fill(0);

  // نهر يقسم الخريطة عموديًا مع جسر واحد في المنتصف + تلال صلبة
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const wx = x * cellSize + 10;
      const wy = y * cellSize + 10;
      const isRiver = wx >= 540 && wx <= 640;
      const isBridge = wy >= 350 && wy <= 430;
      if (isRiver && !isBridge) navGrid[y * cols + x] = 1;
      if (wx >= 760 && wx <= 860 && wy >= 100 && wy <= 280) navGrid[y * cols + x] = 2;
    }
  }

  const svgOrUrl = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800">
    <defs>
      <pattern id="gridValley" width="60" height="60" patternUnits="userSpaceOnUse">
        <path d="M 60 0 L 0 0 0 60" fill="none" stroke="#e7e5e4" stroke-width="0.6" opacity="0.1"/>
      </pattern>
    </defs>
    <rect width="1200" height="800" fill="#3a4732"/>
    <rect width="1200" height="800" fill="url(#gridValley)"/>
    <path d="M160,400 L530,390 M650,390 L1000,480" stroke="#a8a29e" stroke-width="18" stroke-linecap="round" fill="none" opacity="0.4"/>
    <path d="M450,230 L535,380 M645,380 L950,170" stroke="#a8a29e" stroke-width="10" stroke-linecap="round" fill="none" opacity="0.28"/>
    <rect x="540" y="0" width="100" height="800" fill="#1d4ed8" opacity="0.72"/>
    <line x1="540" y1="0" x2="540" y2="800" stroke="#60a5fa" stroke-width="2" opacity="0.5"/>
    <line x1="640" y1="0" x2="640" y2="800" stroke="#60a5fa" stroke-width="2" opacity="0.5"/>
    <rect x="530" y="350" width="120" height="80" rx="4" fill="#78716c" stroke="#e7e5e4" stroke-width="3.5"/>
    <line x1="534" y1="390" x2="646" y2="390" stroke="#d6d3d1" stroke-width="2" stroke-dasharray="10 8" opacity="0.7"/>
    <rect x="760" y="100" width="100" height="180" rx="20" fill="#57534e" stroke="#292524" stroke-width="4"/>
    <rect x="774" y="122" width="72" height="136" rx="14" fill="#44403c" stroke="#78716c" stroke-width="1.5" opacity="0.7"/>
    <text x="562" y="338" fill="#fef08a" font-size="16" font-family="IBM Plex Sans Arabic, system-ui, sans-serif">الجسر</text>
    <text x="790" y="195" fill="#e7e5e4" font-size="16" font-family="IBM Plex Sans Arabic, system-ui, sans-serif">جبل</text>
  </svg>`;

  return {
    id: 'tactical_valley',
    title: 'خريطة ميدان: الوادي والجسر',
    kind: 'tactical',
    width,
    height,
    cellSize,
    cols,
    rows,
    navGrid,
    svgOrUrl,
    anchors: {
      base_blue: { x: 180, y: 400, label: 'القاعدة الغربية' },
      bridge_mid: { x: 590, y: 390, label: 'الجسر الأوسط' },
      outpost_site: { x: 450, y: 230, label: 'موقع الإمداد' },
      hill_east: { x: 980, y: 490, label: 'المرتفع الشرقي' },
      north_flank: { x: 950, y: 170, label: 'الجناح الشمالي' }
    },
    zones: {
      east_sector: {
        id: 'east_sector',
        label: 'القطاع الشرقي',
        polygon: [
          { x: 660, y: 60 },
          { x: 1140, y: 60 },
          { x: 1140, y: 740 },
          { x: 660, y: 740 }
        ]
      }
    }
  };
}

export const DEMO_MAPS: Record<string, MapPack> = {
  geopolitics_strait: buildStraitMap(),
  tactical_valley: buildValleyMap()
};

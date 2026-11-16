// Structural checks for imported pack bundles and a guard for asset URLs.
// Runs before anything is written to IndexedDB, so malformed or hostile
// packs are rejected instead of breaking the next load.
import { ActorPack, Domain, MapPack, PackBundle } from '../core/types';

const MAP_KINDS = ['geopolitical', 'tactical'] as const;
const ACTOR_KINDS = ['person', 'vehicle', 'ship', 'building', 'air'] as const;
const DOMAINS: Domain[] = ['land', 'sea', 'air'];

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isPosNum = (v: unknown): v is number => isNum(v) && v > 0;

/**
 * Accepts inline SVG markup, data: and blob: URLs, and same-origin relative paths.
 * Rejects absolute http(s) URLs and protocol-relative URLs so a pack cannot make
 * the browser fetch third-party resources.
 */
export function isSafeAssetUrl(src: string): boolean {
  const s = src.trim();
  if (s.startsWith('<svg')) return true;
  if (/^(data:image\/|blob:)/i.test(s)) return true;
  if (s.startsWith('//')) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return false; // any other scheme (http:, https:, javascript:, ...)
  return s.startsWith('/') || s.startsWith('./') || !s.includes(':');
}

export function validateMapPack(m: unknown, where: string): string[] {
  const errs: string[] = [];
  if (!isObj(m)) return [`${where}: يجب أن تكون الخريطة كائنًا`];
  const id = m.id;
  const at = `${where} (${typeof id === 'string' ? id : '?'})`;
  if (typeof m.id !== 'string' || !m.id) errs.push(`${at}: معرّف الخريطة مطلوب`);
  if (typeof m.title !== 'string') errs.push(`${at}: العنوان مطلوب`);
  if (!MAP_KINDS.includes(m.kind as (typeof MAP_KINDS)[number])) errs.push(`${at}: kind يجب أن يكون geopolitical أو tactical`);
  for (const k of ['width', 'height', 'cellSize', 'cols', 'rows'] as const) {
    if (!isPosNum(m[k])) errs.push(`${at}: ${k} يجب أن يكون رقمًا موجبًا`);
  }
  if (isPosNum(m.cols) && isPosNum(m.rows)) {
    if (!Array.isArray(m.navGrid) || m.navGrid.length !== m.cols * m.rows) {
      errs.push(`${at}: navGrid يجب أن يحتوي cols × rows عنصرًا`);
    } else if (!m.navGrid.every((c) => c === 0 || c === 1 || c === 2 || c === 3)) {
      errs.push(`${at}: خلايا navGrid يجب أن تكون من القيم 0 أو 1 أو 2 أو 3`);
    }
  } else if (!Array.isArray(m.navGrid)) {
    errs.push(`${at}: navGrid مطلوب`);
  }
  if (m.unitScaleMultiplier !== undefined && !isPosNum(m.unitScaleMultiplier)) {
    errs.push(`${at}: unitScaleMultiplier يجب أن يكون رقمًا موجبًا`);
  }
  if (typeof m.svgOrUrl !== 'string' || !m.svgOrUrl) {
    errs.push(`${at}: svgOrUrl مطلوب`);
  } else if (!isSafeAssetUrl(m.svgOrUrl)) {
    errs.push(`${at}: svgOrUrl يجب أن يكون SVG مضمّنًا أو رابطًا محليًا، لا رابط خارجي`);
  }
  if (!isObj(m.anchors)) {
    errs.push(`${at}: anchors يجب أن يكون كائنًا`);
  } else {
    for (const [name, p] of Object.entries(m.anchors)) {
      if (!isObj(p) || !isNum(p.x) || !isNum(p.y)) errs.push(`${at}: المرساة ${name} يجب أن تحمل x و y رقميين`);
    }
  }
  if (!isObj(m.zones)) {
    errs.push(`${at}: zones يجب أن يكون كائنًا`);
  } else {
    for (const [zName, z] of Object.entries(m.zones)) {
      if (
        !isObj(z) ||
        !Array.isArray(z.polygon) ||
        z.polygon.length < 3 ||
        !z.polygon.every((p) => isObj(p) && isNum(p.x) && isNum(p.y))
      ) {
        errs.push(`${at}: المنطقة ${zName} يجب أن تحتوي مضلعًا من 3 نقاط صالحة على الأقل`);
      }
    }
  }
  return errs;
}

export function validateActorPack(a: unknown, where: string): string[] {
  const errs: string[] = [];
  if (!isObj(a)) return [`${where}: يجب أن يكون الكيان كائنًا`];
  const at = `${where} (${typeof a.id === 'string' ? a.id : '?'})`;
  if (typeof a.id !== 'string' || !a.id) errs.push(`${at}: المعرّف مطلوب`);
  if (typeof a.label !== 'string') errs.push(`${at}: label مطلوب`);
  if (typeof a.svg !== 'string' || !a.svg) {
    errs.push(`${at}: svg مطلوب`);
  } else if (!isSafeAssetUrl(a.svg)) {
    errs.push(`${at}: svg يجب أن يكون SVG مضمّنًا أو رابطًا محليًا، لا رابط خارجي`);
  }
  if (a.kind !== undefined && !ACTOR_KINDS.includes(a.kind as (typeof ACTOR_KINDS)[number])) {
    errs.push(`${at}: kind غير معروف`);
  }
  if (a.domain !== undefined && !DOMAINS.includes(a.domain as Domain)) errs.push(`${at}: domain غير معروف`);
  for (const k of ['speed', 'turnRate', 'scale', 'radius'] as const) {
    if (a[k] !== undefined && !(isNum(a[k]) && (a[k] as number) >= 0)) errs.push(`${at}: ${k} يجب أن يكون رقمًا غير سالب`);
  }
  return errs;
}

/** Returns a list of human-readable errors; an empty list means the bundle is safe to store. */
export function validatePackBundle(bundle: unknown): string[] {
  if (!isObj(bundle)) return ['الملف لا يحتوي على حزمة صالحة'];
  const errs: string[] = [];
  if (bundle.maps !== undefined) {
    if (!Array.isArray(bundle.maps)) errs.push('maps يجب أن تكون قائمة');
    else bundle.maps.forEach((m, i) => errs.push(...validateMapPack(m, `maps[${i}]`)));
  }
  if (bundle.actors !== undefined) {
    if (!Array.isArray(bundle.actors)) errs.push('actors يجب أن تكون قائمة');
    else bundle.actors.forEach((a, i) => errs.push(...validateActorPack(a, `actors[${i}]`)));
  }
  return errs;
}

export type { ActorPack, MapPack, PackBundle };

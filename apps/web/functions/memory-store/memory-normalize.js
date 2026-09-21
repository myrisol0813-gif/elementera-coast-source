import { MEMORY_CONFIG } from '../memory-config.js';
import { MemoryStoreError, clip, iso } from './memory-db.js';

export const MEMORY_OWNER_ID = MEMORY_CONFIG.owner;
export const MAX_SOURCE_TEXT = 12000;
export const MAX_TITLE = 120;
export const MAX_LIFE_CORE = 2000;
export const MAX_HINT = 1200;
export const MAX_ENTRY_CONTENT = 6000;
export const MAX_SOIL_TEXT = 4000;
export const MAX_SOURCE_EXCERPT = 1200;
export const MAX_HAND_SEEDS = MEMORY_CONFIG.soil.maxHandSeeds;
export const POCKET_SOURCE_TYPES = new Set(['turn', 'soil']);
export const POCKET_STATUSES = new Set(['pending', 'confirmed', 'discarded', 'stone', 'archived']);
export const ENTRY_TYPES = new Set(['seed', 'memory']);
export const ENTRY_SCOPES = new Set(['conversation', 'global']);
export const ENTRY_STATUSES = new Set(['active', 'dormant', 'archived', 'stone', 'discarded']);
export const MEMORY_LEVELS = new Set(['ordinary', 'core']);
export const MEMORY_TAGS = Object.freeze([
  '关系',
  '历史锚点',
  '偏好',
  '人物档案',
  '世界观',
  '工程技术',
]);
const MEMORY_TAG_SET = new Set(MEMORY_TAGS);
export const MAX_SOURCE_MODEL = 120;
export const MAX_SOURCE_WINDOW = 180;
export const MAX_CUSTOM_INSTRUCTIONS = 32000;
export const ENTRY_SEARCH_SCAN_LIMIT = 500;

function normalizeHandSeed(value = {}) {
  if (typeof value === 'string') {
    const lifeCore = clip(value, MAX_LIFE_CORE);
    return lifeCore ? { name: clip(lifeCore, MAX_TITLE), life_core: lifeCore, usage_hint: '', avoid_hint: '' } : null;
  }
  const lifeCore = clip(value.life_core ?? value.lifeCore, MAX_LIFE_CORE);
  const name = clip(value.name ?? value.title, MAX_TITLE);
  if (!lifeCore && !name) return null;
  return {
    name: name || clip(lifeCore, MAX_TITLE),
    life_core: lifeCore || name,
    usage_hint: clip(value.usage_hint ?? value.usageHint, MAX_HINT),
    avoid_hint: clip(value.avoid_hint ?? value.avoidHint, MAX_HINT),
  };
}

export function normalizeHandSeeds(value) {
  return (Array.isArray(value) ? value : [])
    .map(normalizeHandSeed)
    .filter(Boolean)
    .slice(0, MAX_HAND_SEEDS);
}

export function stableCandidateKey(value) {
  let hash = 2166136261;
  for (const character of String(value || '').normalize('NFKC')) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function normalizeCandidateSourceRef(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const turnId = clip(value.turn_id ?? value.turnId, 160);
  const role = String(value.role || '').trim();
  if (!turnId || !['user', 'assistant', 'turn'].includes(role)) return null;
  return { turn_id: turnId, role };
}

export function normalizeCandidateId(value, lifeCore) {
  const supplied = String(value || '').replace(/[^\w:.-]/g, '_').replace(/^_+|_+$/g, '').slice(0, 160);
  return supplied || `candidate_${stableCandidateKey(lifeCore)}`;
}

export function normalizePocketCandidate(value, options = {}) {
  if (typeof value === 'string') {
    const text = clip(value, MAX_LIFE_CORE);
    if (!text) return null;
    return {
      candidate_id: normalizeCandidateId('', text),
      title: clip(text, MAX_TITLE),
      life_core: text,
      content: clip(text, MAX_ENTRY_CONTENT),
      usage_hint: '',
      avoid_hint: '',
      source_refs: [],
      source_excerpt: '',
    };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const title = clip(value.title ?? value.name, MAX_TITLE);
  const lifeCore = clip(value.life_core ?? value.lifeCore ?? value.text ?? value.content ?? title, MAX_LIFE_CORE);
  if (!title && !lifeCore) return null;
  const allowedTurnIds = options.allowedTurnIds instanceof Set ? options.allowedTurnIds : null;
  let sourceRefs = (Array.isArray(value.source_refs) ? value.source_refs : [])
    .map(normalizeCandidateSourceRef)
    .filter((reference) => reference && (!allowedTurnIds || allowedTurnIds.has(reference.turn_id)))
    .slice(0, 8);
  if (!sourceRefs.length && options.fallbackSourceRef) {
    const fallback = normalizeCandidateSourceRef(options.fallbackSourceRef);
    if (fallback && (!allowedTurnIds || allowedTurnIds.has(fallback.turn_id))) sourceRefs = [fallback];
  }
  return {
    candidate_id: normalizeCandidateId(value.candidate_id ?? value.candidateId, lifeCore || title),
    title: title || clip(lifeCore, MAX_TITLE),
    life_core: lifeCore || title,
    content: clip(value.content ?? value.text ?? lifeCore ?? title, MAX_ENTRY_CONTENT),
    usage_hint: clip(value.usage_hint ?? value.usageHint, MAX_HINT),
    avoid_hint: clip(value.avoid_hint ?? value.avoidHint, MAX_HINT),
    source_refs: sourceRefs,
    source_excerpt: clip(value.source_excerpt ?? value.sourceExcerpt ?? options.fallbackExcerpt, MAX_SOURCE_EXCERPT),
  };
}

export function normalizePocketCandidates(value, options = {}) {
  return (Array.isArray(value) ? value : [])
    .map((item) => normalizePocketCandidate(item, options))
    .filter(Boolean)
    .slice(0, MAX_HAND_SEEDS);
}

export function sourceRef(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const serialized = JSON.stringify(value);
  if (serialized.length > 4000) throw new MemoryStoreError('source_ref_too_large', '落袋来源信息过长。', 413);
  return JSON.parse(serialized);
}

export function memoryTags(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((item) => clip(item, 80))
    .filter(Boolean))].slice(0, 30);
}

export function normalizeMemoryTag(value, { allowEmpty = true } = {}) {
  const tag = clip(value, 40);
  if (!tag && allowEmpty) return '';
  if (!MEMORY_TAG_SET.has(tag)) {
    throw new MemoryStoreError('invalid_memory_tag', `标签必须是：${MEMORY_TAGS.join(' / ')}。`);
  }
  return tag;
}

export function mappedLegacyTag(value) {
  const tags = memoryTags(value);
  for (const tag of tags) {
    if (MEMORY_TAG_SET.has(tag)) return tag;
    const normalized = tag.toLocaleLowerCase('zh-CN');
    const aliases = [
      ['关系', ['relationship', '关系', '相爱', '恋爱']],
      ['历史锚点', ['history', '历史', '锚点', '纪念']],
      ['偏好', ['preference', '偏好', '喜欢', '不喜欢']],
      ['人物档案', ['profile', '人物', '档案', '形象', '身份']],
      ['世界观', ['worldbook', 'coast', '世界观', '项目世界观', '设定']],
      ['工程技术', ['engineering', 'technical', '工程', '技术', '代码', '部署', 'mcp']],
    ];
    const matched = aliases.find(([, words]) => words.some((word) => normalized.includes(word)));
    if (matched) return matched[0];
  }
  return '';
}

export function sourceTimestamp(value, fallback = Date.now()) {
  if (value == null || value === '') return Math.trunc(fallback);
  const number = typeof value === 'number' ? value : Date.parse(String(value));
  if (!Number.isFinite(number) || number <= 0) {
    throw new MemoryStoreError('invalid_memory_source_time', '记忆来源时间无效。');
  }
  return Math.trunc(number);
}

export function sourceDate(value) {
  const timestamp = Number(value || 0);
  return Number.isFinite(timestamp) && timestamp > 0
    ? new Date(timestamp).toISOString().slice(0, 10)
    : '';
}

export function entryIndexFromRow(row, reference, legacyTags) {
  const tag = normalizeMemoryTag(row.tag, { allowEmpty: true }) || mappedLegacyTag(legacyTags);
  const sourceModel = clip(
    row.source_model
      || reference.source_model
      || reference.model_label
      || reference.generated_by_model
      || reference.model,
    MAX_SOURCE_MODEL,
  );
  const sourceWindow = clip(
    row.source_window
      || reference.source_window
      || reference.conversation_title
      || reference.source_conversation_id
      || row.conversation_id,
    MAX_SOURCE_WINDOW,
  );
  const timestamp = Number(row.source_time || row.created_at || 0);
  return {
    source_model: sourceModel,
    source_window: sourceWindow,
    source_time: iso(timestamp),
    source_date: sourceDate(timestamp),
    tag,
    migration_status: row.migration_status || (tag ? '' : '待整理'),
  };
}

export function confirmedTimestamp(value, fallback = null) {
  if (value == null || value === '') return fallback;
  const number = typeof value === 'number' ? value : Date.parse(String(value));
  if (!Number.isFinite(number) || number <= 0) {
    throw new MemoryStoreError('invalid_confirmed_time', '记忆确认时间无效。');
  }
  return Math.trunc(number);
}

export function normalizeEntryType(value) {
  const entryType = String(value || 'memory');
  if (!ENTRY_TYPES.has(entryType)) throw new MemoryStoreError('invalid_entry_type', '种子或记忆类型无效。');
  return entryType;
}

export function normalizeScope(value) {
  const scope = String(value || 'conversation');
  if (!ENTRY_SCOPES.has(scope)) throw new MemoryStoreError('invalid_entry_scope', '记忆范围无效。');
  return scope;
}

export function normalizeStatus(value, fallback = 'active') {
  const status = String(value || fallback);
  if (!ENTRY_STATUSES.has(status)) throw new MemoryStoreError('invalid_entry_status', '种子或记忆状态无效。');
  return status;
}

export function normalizeMemoryLevel(value, entryType) {
  const level = String(value || 'ordinary');
  if (!MEMORY_LEVELS.has(level)) throw new MemoryStoreError('invalid_memory_level', '记忆保护级别无效。');
  return entryType === 'memory' ? level : 'ordinary';
}

export async function normalizedEntry(value = {}, defaults = {}) {
  const entryType = normalizeEntryType(value.entry_type ?? defaults.entry_type);
  const title = clip(value.title ?? defaults.title, MAX_TITLE);
  const lifeCore = clip(value.life_core ?? defaults.life_core, MAX_LIFE_CORE);
  if (!title || !lifeCore) throw new MemoryStoreError('entry_fields_required', '标题与生命核不能为空。');
  const reference = sourceRef(value.source_ref ?? defaults.source_ref);
  const legacyTags = memoryTags(value.memory_tags ?? defaults.memory_tags);
  const tag = normalizeMemoryTag(value.tag ?? defaults.tag, { allowEmpty: true }) || mappedLegacyTag(legacyTags);
  return {
    id: value.id ?? defaults.id ?? crypto.randomUUID(),
    entry_type: entryType,
    scope: 'global',
    conversation_id: null,
    title,
    life_core: lifeCore,
    content: clip(value.content ?? defaults.content, MAX_ENTRY_CONTENT),
    usage_hint: clip(value.usage_hint ?? defaults.usage_hint, MAX_HINT),
    avoid_hint: clip(value.avoid_hint ?? defaults.avoid_hint, MAX_HINT),
    source_type: clip(value.source_type ?? defaults.source_type ?? 'manual', 40) || 'manual',
    source_ref: reference,
    promoted_from_id: value.promoted_from_id ?? defaults.promoted_from_id ?? null,
    memory_level: normalizeMemoryLevel(value.memory_level ?? defaults.memory_level, entryType),
    status: normalizeStatus(value.status ?? defaults.status, entryType === 'seed' ? 'dormant' : 'active'),
    memory_tags: tag ? [tag] : legacyTags,
    source_model: clip(value.source_model ?? defaults.source_model ?? reference.source_model ?? reference.model_label ?? reference.generated_by_model ?? reference.model, MAX_SOURCE_MODEL),
    source_window: clip(value.source_window ?? defaults.source_window ?? reference.source_window ?? reference.source_conversation_id, MAX_SOURCE_WINDOW),
    source_time: sourceTimestamp(value.source_time ?? defaults.source_time, Date.now()),
    tag,
    migration_status: tag ? '' : clip(value.migration_status ?? defaults.migration_status ?? '待整理', 40),
    last_confirmed_at: confirmedTimestamp(value.last_confirmed_at ?? defaults.last_confirmed_at, Date.now()),
  };
}

export function normalizedFingerprintCore(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('zh-CN').replace(/\s+/g, ' ').trim();
}

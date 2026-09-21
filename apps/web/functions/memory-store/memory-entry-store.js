import { getConversation, sanitizeId } from '../chat-store.js';
import { buildSafeSearchQuery, rankSearchRecords, searchMetadata } from '../search-query.js';
import { MemoryStoreError, all, clip, first, iso, parseJson, run } from './memory-db.js';
import {
  ENTRY_SEARCH_SCAN_LIMIT,
  MAX_ENTRY_CONTENT,
  MAX_HINT,
  MAX_LIFE_CORE,
  MAX_SOURCE_MODEL,
  MAX_SOURCE_WINDOW,
  MAX_TITLE,
  MEMORY_OWNER_ID,
  confirmedTimestamp,
  entryIndexFromRow,
  mappedLegacyTag,
  memoryTags,
  normalizeMemoryLevel,
  normalizeMemoryTag,
  normalizeScope,
  normalizeStatus,
  normalizeEntryType,
  normalizedEntry,
  sourceRef,
  sourceTimestamp,
} from './memory-normalize.js';
import { ensureMemorySchema } from './memory-schema.js';

export function entryFromRow(row) {
  const reference = sourceRef(parseJson(row.source_ref_json, {}));
  const legacyTags = memoryTags(parseJson(row.memory_tags_json, []));
  return {
    id: row.id,
    entry_type: row.entry_type,
    scope: row.scope,
    conversation_id: row.conversation_id || null,
    title: row.title || '',
    life_core: row.life_core || '',
    content: row.content || '',
    usage_hint: row.usage_hint || '',
    avoid_hint: row.avoid_hint || '',
    source_type: row.source_type || 'manual',
    source_ref: reference,
    promoted_from_id: row.promoted_from_id || null,
    memory_level: row.memory_level || 'ordinary',
    status: row.status,
    user_confirmed: Number(row.user_confirmed || 0) === 1,
    recall_count: Number(row.recall_count || 0),
    last_recalled_at: iso(row.last_recalled_at),
    vector_id: row.vector_id || null,
    embedding_model: row.embedding_model || null,
    embedding_version: row.embedding_version || null,
    embedding_status: row.embedding_status || 'pending',
    embedded_at: iso(row.embedded_at),
    memory_tags: legacyTags,
    ...entryIndexFromRow(row, reference, legacyTags),
    last_confirmed_at: iso(row.last_confirmed_at),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    deleted_at: iso(row.deleted_at),
  };
}

export async function requireEntryRow(db, id) {
  const entryId = sanitizeId(id, 'memory');
  const row = await first(db, `SELECT * FROM memory_entries
    WHERE id = ? AND user_id = ? AND deleted_at IS NULL`, [entryId, MEMORY_OWNER_ID]);
  if (!row) throw new MemoryStoreError('entry_not_found', '种子或记忆不存在。', 404);
  return row;
}

export async function normalizeStoredEntry(value = {}, defaults = {}) {
  const entry = await normalizedEntry(value, defaults);
  return { ...entry, id: sanitizeId(entry.id, 'memory') };
}

export function insertEntryStatement(db, entry, timestamp) {
  return db.prepare(`INSERT INTO memory_entries (
    id, user_id, entry_type, scope, conversation_id, title, life_core, content,
    usage_hint, avoid_hint, source_type, source_ref_json, promoted_from_id,
    memory_level, status, user_confirmed, recall_count, last_recalled_at,
    vector_id, embedding_model, embedding_version, embedding_status, embedded_at,
    memory_tags_json, source_model, source_window, source_time, tag, migration_status,
    last_confirmed_at, created_at, updated_at, deleted_at
  ) VALUES (?, ?, ?, 'global', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, NULL, NULL, NULL, NULL, 'pending', NULL,
    ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`).bind(
    entry.id, MEMORY_OWNER_ID, entry.entry_type, entry.title, entry.life_core, entry.content,
    entry.usage_hint, entry.avoid_hint, entry.source_type, JSON.stringify(entry.source_ref),
    entry.promoted_from_id, entry.memory_level, entry.status, JSON.stringify(entry.memory_tags),
    entry.source_model, entry.source_window, entry.source_time, entry.tag, entry.migration_status,
    entry.last_confirmed_at, timestamp, timestamp,
  );
}

export async function getEntry(db, id) {
  await ensureMemorySchema(db);
  return entryFromRow(await requireEntryRow(db, id));
}

export async function createEntry(db, value = {}) {
  await ensureMemorySchema(db);
  const entry = await normalizeStoredEntry(value);
  await insertEntryStatement(db, entry, Date.now()).run();
  return getEntry(db, entry.id);
}

function facetValues(entries, key) {
  return [...new Set(entries.map((entry) => entry[key]).filter(Boolean))]
    .sort((left, right) => String(left).localeCompare(String(right), 'zh-CN'));
}

function entryFacets(entries) {
  return {
    models: facetValues(entries, 'source_model'),
    windows: facetValues(entries, 'source_window'),
    tags: facetValues(entries, 'tag'),
    times: facetValues(entries, 'source_date').reverse(),
  };
}

function matchesEntryIndex(entry, options) {
  return (!options.source_model || entry.source_model === options.source_model)
    && (!options.source_window || entry.source_window === options.source_window)
    && (!options.tag || entry.tag === options.tag)
    && (!options.source_time || entry.source_date === options.source_time);
}

export async function listEntries(db, options = {}) {
  await ensureMemorySchema(db);
  const conditions = ['user_id = ?', 'deleted_at IS NULL'];
  const params = [MEMORY_OWNER_ID];
  if (options.entry_type) {
    conditions.push('entry_type = ?');
    params.push(normalizeEntryType(options.entry_type));
  }
  if (options.scope) {
    const scope = normalizeScope(options.scope);
    conditions.push('scope = ?');
    params.push(scope);
    if (scope === 'conversation') {
      const conversationId = sanitizeId(options.conversation_id, 'conversation');
      await getConversation(db, conversationId);
      conditions.push('conversation_id = ?');
      params.push(conversationId);
    } else {
      conditions.push('conversation_id IS NULL');
    }
  }
  if (options.status) {
    conditions.push('status = ?');
    params.push(normalizeStatus(options.status));
  }
  if (options.library_only) conditions.push("status NOT IN ('archived', 'stone', 'discarded')");
  const search = buildSafeSearchQuery(options.q);
  const limit = Math.min(100, Math.max(1, Number(options.limit) || 40));
  const offset = Math.max(0, Number(options.cursor) || 0);
  const rows = await all(db, `SELECT * FROM memory_entries
    WHERE ${conditions.join(' AND ')}
    ORDER BY updated_at DESC, created_at DESC
    LIMIT ?`, [...params, ENTRY_SEARCH_SCAN_LIMIT]);
  const allEntries = rows.map(entryFromRow);
  const facets = entryFacets(allEntries);
  const indexed = allEntries.filter((entry) => matchesEntryIndex(entry, options));
  const ranked = search.terms.length
    ? rankSearchRecords(
      indexed,
      search,
      (entry) => [
        entry.title,
        entry.life_core,
        entry.content,
        entry.usage_hint,
        entry.avoid_hint,
      ].filter(Boolean).join(' '),
    )
    : indexed;
  return {
    entries: ranked.slice(offset, offset + limit),
    next_cursor: ranked.length > offset + limit ? String(offset + limit) : null,
    search: searchMetadata(search),
    facets,
  };
}

export async function patchEntry(db, id, value = {}) {
  await ensureMemorySchema(db);
  const row = await requireEntryRow(db, id);
  const title = value.title == null ? row.title : clip(value.title, MAX_TITLE);
  const lifeCore = value.life_core == null ? row.life_core : clip(value.life_core, MAX_LIFE_CORE);
  if (!title || !lifeCore) throw new MemoryStoreError('entry_fields_required', '标题与生命核不能为空。');
  const status = value.status == null ? row.status : normalizeStatus(value.status);
  const memoryLevel = value.memory_level == null ? row.memory_level : normalizeMemoryLevel(value.memory_level, row.entry_type);
  const legacyTags = value.memory_tags == null ? parseJson(row.memory_tags_json, []) : memoryTags(value.memory_tags);
  const tag = value.tag == null
    ? normalizeMemoryTag(row.tag, { allowEmpty: true }) || mappedLegacyTag(legacyTags)
    : normalizeMemoryTag(value.tag, { allowEmpty: false });
  const timestamp = Date.now();
  await run(db, `UPDATE memory_entries SET
    scope = 'global', conversation_id = NULL, title = ?, life_core = ?, content = ?,
    usage_hint = ?, avoid_hint = ?, status = ?, memory_level = ?, memory_tags_json = ?,
    source_model = ?, source_window = ?, source_time = ?, tag = ?, migration_status = ?,
    last_confirmed_at = ?, embedding_status = 'pending', updated_at = ?
    WHERE id = ? AND user_id = ? AND deleted_at IS NULL`, [
    title, lifeCore,
    value.content == null ? row.content : clip(value.content, MAX_ENTRY_CONTENT),
    value.usage_hint == null ? row.usage_hint : clip(value.usage_hint, MAX_HINT),
    value.avoid_hint == null ? row.avoid_hint : clip(value.avoid_hint, MAX_HINT),
    status, memoryLevel, JSON.stringify(tag ? [tag] : legacyTags),
    value.source_model == null ? row.source_model : clip(value.source_model, MAX_SOURCE_MODEL),
    value.source_window == null ? row.source_window : clip(value.source_window, MAX_SOURCE_WINDOW),
    value.source_time == null ? (row.source_time || row.created_at) : sourceTimestamp(value.source_time),
    tag, tag ? '' : (row.migration_status || '待整理'),
    value.last_confirmed_at == null ? row.last_confirmed_at : confirmedTimestamp(value.last_confirmed_at),
    timestamp, row.id, MEMORY_OWNER_ID,
  ]);
  return { entry: await getEntry(db, row.id), copied: false };
}

export async function deleteEntry(db, id) {
  await ensureMemorySchema(db);
  const row = await requireEntryRow(db, id);
  const timestamp = Date.now();
  await run(db, `UPDATE memory_entries SET deleted_at = ?, updated_at = ?
    WHERE id = ? AND user_id = ? AND deleted_at IS NULL`, [timestamp, timestamp, row.id, MEMORY_OWNER_ID]);
  return { ...entryFromRow(row), deleted_at: iso(timestamp) };
}

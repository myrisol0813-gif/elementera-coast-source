import { getConversation, sanitizeId } from '../chat-store.js';
import { MemoryStoreError, all, clip, first, iso, parseJson, run } from './memory-db.js';
import {
  MAX_ENTRY_CONTENT,
  MAX_HINT,
  MAX_LIFE_CORE,
  MAX_SOURCE_EXCERPT,
  MAX_SOURCE_TEXT,
  MAX_TITLE,
  MEMORY_OWNER_ID,
  POCKET_SOURCE_TYPES,
  POCKET_STATUSES,
  memoryTags,
  normalizeCandidateId,
  normalizeCandidateSourceRef,
  normalizeMemoryTag,
  normalizePocketCandidates,
  normalizedFingerprintCore,
  sourceRef,
} from './memory-normalize.js';
import { ensureMemorySchema } from './memory-schema.js';
import { getEntry, insertEntryStatement, normalizeStoredEntry } from './memory-entry-store.js';

export function pocketFromRow(row) {
  const reference = sourceRef(parseJson(row.source_ref_json, {}));
  let sourceRefs = (Array.isArray(parseJson(row.source_refs_json, [])) ? parseJson(row.source_refs_json, []) : [])
    .map(normalizeCandidateSourceRef)
    .filter(Boolean)
    .slice(0, 8);
  if (!sourceRefs.length) {
    const legacyReference = normalizeCandidateSourceRef(reference);
    if (legacyReference) sourceRefs = [legacyReference];
  }
  const title = row.title || row.suggested_title || clip(row.source_text, MAX_TITLE);
  const lifeCore = row.life_core || row.suggested_life_core || row.source_text || title;
  const content = row.content || row.source_text || lifeCore;
  const usageHint = row.usage_hint || row.suggested_usage_hint || '';
  const avoidHint = row.avoid_hint || row.suggested_avoid_hint || '';
  return {
    id: row.id,
    entry_type: 'pocket',
    conversation_id: row.conversation_id,
    source_type: row.source_type,
    source_ref: reference,
    source_text: row.source_text || '',
    candidate_id: row.candidate_id || normalizeCandidateId('', lifeCore),
    title,
    life_core: lifeCore,
    content,
    usage_hint: usageHint,
    avoid_hint: avoidHint,
    source_refs: sourceRefs,
    source_excerpt: row.source_excerpt || '',
    fingerprint: row.fingerprint || null,
    suggested_title: title,
    suggested_life_core: lifeCore,
    suggested_usage_hint: usageHint,
    suggested_avoid_hint: avoidHint,
    status: row.status,
    resolved_entry_id: row.resolved_entry_id || null,
    user_confirmed: row.status === 'confirmed',
    recall_count: Number(row.recall_count || 0),
    last_recalled_at: iso(row.last_recalled_at),
    vector_ids: (Array.isArray(parseJson(row.vector_ids_json, [])) ? parseJson(row.vector_ids_json, []) : []).map(String).filter(Boolean),
    embedding_model: row.embedding_model || null,
    embedding_version: row.embedding_version || null,
    embedding_status: row.embedding_status || 'pending',
    embedded_at: iso(row.embedded_at),
    memory_tags: memoryTags(parseJson(row.memory_tags_json, [])),
    last_confirmed_at: iso(row.last_confirmed_at),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    deleted_at: iso(row.deleted_at),
  };
}

export async function requirePocketRow(db, id) {
  const pocketId = sanitizeId(id, 'pocket');
  const row = await first(db, `SELECT * FROM memory_pockets
    WHERE id = ? AND user_id = ? AND deleted_at IS NULL`, [pocketId, MEMORY_OWNER_ID]);
  if (!row) throw new MemoryStoreError('pocket_not_found', '待确认区条目不存在。', 404);
  return row;
}

export async function getPocket(db, id) {
  await ensureMemorySchema(db);
  return pocketFromRow(await requirePocketRow(db, id));
}

export async function createPocket(db, value = {}) {
  await ensureMemorySchema(db);
  const conversationId = sanitizeId(value.conversation_id, 'conversation');
  await getConversation(db, conversationId);
  const sourceType = String(value.source_type || 'turn');
  if (!POCKET_SOURCE_TYPES.has(sourceType)) throw new MemoryStoreError('invalid_source_type', '待确认候选来源无效。');
  const sourceText = clip(value.source_text, MAX_SOURCE_TEXT);
  if (!sourceText) throw new MemoryStoreError('source_text_required', '没有可以进入待确认区的内容。');
  const reference = sourceRef(value.source_ref);
  let sourceRefs = (Array.isArray(value.source_refs) ? value.source_refs : [])
    .map(normalizeCandidateSourceRef)
    .filter(Boolean)
    .slice(0, 8);
  if (!sourceRefs.length) {
    const fallbackReference = normalizeCandidateSourceRef(reference);
    if (fallbackReference) sourceRefs = [fallbackReference];
  }
  const title = clip(value.title ?? value.suggested_title ?? sourceText.replace(/\s+/g, ' '), MAX_TITLE);
  const lifeCore = clip(value.life_core ?? value.suggested_life_core ?? sourceText, MAX_LIFE_CORE);
  const content = clip(value.content ?? sourceText, MAX_ENTRY_CONTENT);
  const usageHint = clip(value.usage_hint ?? value.suggested_usage_hint, MAX_HINT);
  const avoidHint = clip(value.avoid_hint ?? value.suggested_avoid_hint, MAX_HINT);
  const sourceExcerpt = clip(value.source_excerpt, MAX_SOURCE_EXCERPT);
  const fingerprint = clip(value.fingerprint, 160) || null;
  const id = sanitizeId(crypto.randomUUID(), 'pocket');
  const timestamp = Date.now();
  await run(db, `INSERT INTO memory_pockets (
    id, user_id, conversation_id, source_type, source_ref_json, source_text,
    suggested_title, suggested_life_core, suggested_usage_hint, suggested_avoid_hint,
    candidate_id, title, life_core, content, usage_hint, avoid_hint,
    source_refs_json, source_excerpt, fingerprint, status, resolved_entry_id,
    recall_count, last_recalled_at, vector_ids_json, embedding_model,
    embedding_version, embedding_status, embedded_at, created_at, updated_at, deleted_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
    'pending', NULL, 0, NULL, '[]', NULL, NULL, 'pending', NULL, ?, ?, NULL)`, [
    id, MEMORY_OWNER_ID, conversationId, sourceType, JSON.stringify(reference), sourceText,
    title, lifeCore, usageHint, avoidHint, normalizeCandidateId(value.candidate_id, lifeCore),
    title, lifeCore, content, usageHint, avoidHint, JSON.stringify(sourceRefs), sourceExcerpt,
    fingerprint, timestamp, timestamp,
  ]);
  return pocketFromRow(await requirePocketRow(db, id));
}

export async function listPockets(db, { conversation_id: conversationIdValue, status = 'pending' } = {}) {
  await ensureMemorySchema(db);
  const conversationId = sanitizeId(conversationIdValue, 'conversation');
  await getConversation(db, conversationId);
  const pocketStatus = String(status || 'pending');
  if (!POCKET_STATUSES.has(pocketStatus)) throw new MemoryStoreError('invalid_pocket_status', '待确认区状态无效。');
  const rows = await all(db, `SELECT * FROM memory_pockets
    WHERE user_id = ? AND conversation_id = ? AND status = ? AND deleted_at IS NULL
    ORDER BY created_at DESC`, [MEMORY_OWNER_ID, conversationId, pocketStatus]);
  return rows.map(pocketFromRow);
}

export async function patchPocket(db, id, value = {}) {
  await ensureMemorySchema(db);
  const row = await requirePocketRow(db, id);
  if (row.status !== 'pending') throw new MemoryStoreError('pocket_not_pending', '只有待确认候选可以编辑。', 409);
  if (value.status != null && String(value.status) !== 'pending') {
    throw new MemoryStoreError('pocket_status_requires_resolve', '待确认候选只能通过确认或丢弃离开袋子。', 409);
  }
  const current = pocketFromRow(row);
  const title = value.title == null && value.suggested_title == null
    ? current.title : clip(value.title ?? value.suggested_title, MAX_TITLE);
  const lifeCore = value.life_core == null && value.suggested_life_core == null
    ? current.life_core : clip(value.life_core ?? value.suggested_life_core, MAX_LIFE_CORE);
  if (!title || !lifeCore) throw new MemoryStoreError('pocket_fields_required', '待确认候选的标题与生命核不能为空。');
  const content = value.content == null && value.source_text == null
    ? current.content : clip(value.content ?? value.source_text, MAX_ENTRY_CONTENT);
  const usageHint = value.usage_hint == null && value.suggested_usage_hint == null
    ? current.usage_hint : clip(value.usage_hint ?? value.suggested_usage_hint, MAX_HINT);
  const avoidHint = value.avoid_hint == null && value.suggested_avoid_hint == null
    ? current.avoid_hint : clip(value.avoid_hint ?? value.suggested_avoid_hint, MAX_HINT);
  const sourceRefs = value.source_refs == null
    ? current.source_refs
    : (Array.isArray(value.source_refs) ? value.source_refs : []).map(normalizeCandidateSourceRef).filter(Boolean).slice(0, 8);
  const timestamp = Date.now();
  await run(db, `UPDATE memory_pockets SET
    source_text = ?, suggested_title = ?, suggested_life_core = ?, suggested_usage_hint = ?,
    suggested_avoid_hint = ?, candidate_id = ?, title = ?, life_core = ?, content = ?,
    usage_hint = ?, avoid_hint = ?, source_refs_json = ?, source_excerpt = ?,
    embedding_status = 'pending', updated_at = ?
    WHERE id = ? AND user_id = ? AND status = 'pending' AND deleted_at IS NULL`, [
    content, title, lifeCore, usageHint, avoidHint,
    value.candidate_id == null ? current.candidate_id : normalizeCandidateId(value.candidate_id, lifeCore),
    title, lifeCore, content, usageHint, avoidHint, JSON.stringify(sourceRefs),
    value.source_excerpt == null ? current.source_excerpt : clip(value.source_excerpt, MAX_SOURCE_EXCERPT),
    timestamp, row.id, MEMORY_OWNER_ID,
  ]);
  return pocketFromRow(await requirePocketRow(db, row.id));
}

export async function deletePocket(db, id) {
  await ensureMemorySchema(db);
  const row = await requirePocketRow(db, id);
  const timestamp = Date.now();
  await run(db, `UPDATE memory_pockets SET deleted_at = ?, updated_at = ?
    WHERE id = ? AND user_id = ? AND deleted_at IS NULL`, [timestamp, timestamp, row.id, MEMORY_OWNER_ID]);
  return { ...pocketFromRow(row), deleted_at: iso(timestamp) };
}

export async function pocketFingerprint(conversationIdValue, lifeCore) {
  const conversationId = sanitizeId(conversationIdValue, 'conversation');
  const normalized = normalizedFingerprintCore(lifeCore);
  if (!normalized) throw new MemoryStoreError('pocket_life_core_required', '可落袋候选缺少生命核。');
  const bytes = new TextEncoder().encode(`${conversationId}\u0000${normalized}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hexadecimal = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `soil:${hexadecimal}`;
}

export async function upsertSoilPocketCandidates(db, conversationIdValue, value) {
  await ensureMemorySchema(db);
  const conversationId = sanitizeId(conversationIdValue, 'conversation');
  await getConversation(db, conversationId);
  const candidates = normalizePocketCandidates(value);
  const result = { created: 0, updated: 0, suppressed: 0, pockets: [] };
  for (const candidate of candidates) {
    const fingerprint = await pocketFingerprint(conversationId, candidate.life_core);
    let row = await first(db, `SELECT * FROM memory_pockets
      WHERE user_id = ? AND fingerprint = ?
      ORDER BY created_at ASC LIMIT 1`, [MEMORY_OWNER_ID, fingerprint]);
    if (row) {
      if (row.status === 'pending' && !row.deleted_at) {
        const pocket = await patchPocket(db, row.id, candidate);
        result.updated += 1;
        result.pockets.push(pocket);
      } else {
        result.suppressed += 1;
        result.pockets.push(pocketFromRow(row));
      }
      continue;
    }
    try {
      const pocket = await createPocket(db, {
        conversation_id: conversationId,
        source_type: 'soil',
        source_ref: { conversation_id: conversationId, candidate_id: candidate.candidate_id },
        source_text: candidate.content,
        ...candidate,
        fingerprint,
      });
      result.created += 1;
      result.pockets.push(pocket);
    } catch (error) {
      row = await first(db, `SELECT * FROM memory_pockets
        WHERE user_id = ? AND fingerprint = ?
        ORDER BY created_at ASC LIMIT 1`, [MEMORY_OWNER_ID, fingerprint]);
      if (!row) throw error;
      result.suppressed += 1;
      result.pockets.push(pocketFromRow(row));
    }
  }
  return result;
}

export async function resolvePocket(db, id, value = {}) {
  await ensureMemorySchema(db);
  const pocket = await requirePocketRow(db, id);
  if (pocket.status !== 'pending') throw new MemoryStoreError('pocket_already_resolved', '这条内容已经离开待确认区。', 409);
  const action = String(value.action || '');
  if (!['memory', 'seed', 'discard'].includes(action)) {
    throw new MemoryStoreError('invalid_pocket_action', '待确认区只接受 memory / seed / discard。');
  }
  const timestamp = Date.now();
  if (action === 'discard') {
    await run(db, `UPDATE memory_pockets SET status = 'discarded', updated_at = ?
      WHERE id = ? AND user_id = ? AND status = 'pending' AND deleted_at IS NULL`, [timestamp, pocket.id, MEMORY_OWNER_ID]);
    return { pocket: await getPocket(db, pocket.id), entry: null };
  }
  const tag = normalizeMemoryTag(value.tag, { allowEmpty: false });
  const current = pocketFromRow(pocket);
  const entry = await normalizeStoredEntry({
    entry_type: action,
    title: value.title || current.title,
    life_core: value.life_core || current.life_core,
    content: value.content ?? current.content,
    usage_hint: value.usage_hint ?? current.usage_hint,
    avoid_hint: value.avoid_hint ?? current.avoid_hint,
    source_type: 'pocket',
    source_ref: { pocket_id: pocket.id, source_type: pocket.source_type, source_ref: parseJson(pocket.source_ref_json, {}) },
    memory_level: value.memory_level,
    memory_tags: [tag],
    source_model: value.source_model || current.source_ref?.model_label || current.source_ref?.generated_by_model || '',
    source_window: value.source_window || current.source_ref?.source_window || pocket.conversation_id,
    source_time: value.source_time || pocket.created_at,
    tag,
    last_confirmed_at: timestamp,
  });
  await db.batch([
    insertEntryStatement(db, entry, timestamp),
    db.prepare(`UPDATE memory_pockets SET status = 'confirmed', resolved_entry_id = ?,
      memory_tags_json = ?, last_confirmed_at = ?, updated_at = ?
      WHERE id = ? AND user_id = ? AND status = 'pending' AND deleted_at IS NULL`)
      .bind(entry.id, JSON.stringify([tag]), timestamp, timestamp, pocket.id, MEMORY_OWNER_ID),
  ]);
  return { pocket: await getPocket(db, pocket.id), entry: await getEntry(db, entry.id) };
}

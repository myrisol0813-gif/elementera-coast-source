import { ensureChatSchema as ensureSchema } from './chat-schema.js';
import { sanitizeFurnitureRuns } from './tool-furniture-summary.js';

const USER_ID = 'owner';
const MAX_CONTENT = 12000;
const MAX_AVATAR = 500 * 1024;
const MAX_DESK_SLIP_JSON = 256000;
const MAX_TURNS = 400;
const DEFAULT_TITLES = new Set(['', '新聊天', '未命名对话', '主聊天']);
const ROOM_TYPES = new Set(['main', 'radio', 'lighthouse']);
const MESSAGE_SOURCES = new Set(['owner_web', 'official_mcp', 'rikkahub']);
const GENERATION_SOURCES = new Set(['chat', 'landing', 'relay', 'radio', 'lighthouse', 'other']);

export class ChatStoreError extends Error {
  constructor(type, message, status = 400) {
    super(message);
    this.name = 'ChatStoreError';
    this.type = type;
    this.status = status;
  }
}

export function hasChatDatabase(env) {
  return Boolean(env?.COAST_CHAT_DB && typeof env.COAST_CHAT_DB.prepare === 'function');
}

export function sanitizeId(value, fallback = 'id') {
  const clean = String(value || '').replace(/[^\w:.-]/g, '_').slice(0, 160);
  return clean || `${fallback}_${crypto.randomUUID()}`;
}

export function normalizeRoomType(value, fallback = 'main') {
  const clean = String(value || fallback).trim();
  if (!ROOM_TYPES.has(clean)) throw new ChatStoreError('invalid_room_type', '聊天窗口类型无效。', 400);
  return clean;
}

export function sanitizeTitle(value, fallback = '新聊天') {
  const clean = String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/["“”'。.!！?？]+$/g, '')
    .trim()
    .slice(0, 40);
  return clean || fallback;
}

export function isDefaultTitle(value) {
  return DEFAULT_TITLES.has(String(value || '').trim());
}

function nowMs() {
  return Date.now();
}

function iso(value) {
  const timestamp = Number(value || 0);
  return Number.isFinite(timestamp) && timestamp > 0
    ? new Date(timestamp).toISOString()
    : new Date().toISOString();
}

function clip(value, max = MAX_CONTENT) {
  return String(value ?? '').slice(0, max);
}

function clamp(value, length) {
  return length < 1 ? 0 : Math.min(Math.max(0, Number(value) || 0), length - 1);
}

function normalizeAttachments(value) {
  return (Array.isArray(value) ? value : []).slice(0, 12).map((item) => {
    const id = sanitizeId(item?.id || '', 'attachment');
    const type = item?.type === 'image' ? 'image' : 'file';
    const name = clip(item?.name || '附件', 180).replace(/[\r\n\t]+/g, ' ').trim();
    const mime = clip(item?.mime || 'application/octet-stream', 120).trim();
    const size = Math.max(0, Math.trunc(Number(item?.size) || 0));
    const storageKey = clip(item?.storage_key || '', 220).trim();
    const createdAt = typeof item?.created_at === 'string' ? item.created_at : new Date().toISOString();
    if (!item?.id || !name || !storageKey) return null;
    return { id, type, name, mime, size, storage_key: storageKey, created_at: createdAt };
  }).filter(Boolean);
}

function normalizeUsage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const fields = ['prompt_tokens', 'completion_tokens', 'total_tokens'];
  const values = fields.map((field) => Number(value[field]));
  if (!values.every((number) => Number.isFinite(number) && number >= 0)) return null;
  return Object.fromEntries(fields.map((field, index) => [field, Math.trunc(values[index])]));
}

function normalizeDeskSlip(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    const encoded = JSON.stringify(value);
    if (!encoded || encoded.length > MAX_DESK_SLIP_JSON) return null;
    return JSON.parse(encoded);
  } catch {
    return null;
  }
}

async function run(db, sql, params = []) {
  return db.prepare(sql).bind(...params).run();
}

async function first(db, sql, params = []) {
  return db.prepare(sql).bind(...params).first();
}

async function all(db, sql, params = []) {
  const result = await db.prepare(sql).bind(...params).all();
  return result?.results || [];
}

export async function ensureChatSchema(db) {
  return ensureSchema(db, normalizeState);
}

function conversationFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title || '新聊天',
    room_type: normalizeRoomType(row.room_type || 'main'),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    deleted_at: row.deleted_at ? iso(row.deleted_at) : null,
    title_manual: Number(row.title_manual || 0) === 1,
    title_generated_at: row.title_generated_at ? iso(row.title_generated_at) : null,
    title_model_id: row.title_model_id || null,
    source: String(row.source || 'coast').trim() || 'coast',
    source_window_id: row.source_window_id || null,
  };
}

function normalizeVariant(value = {}, prefix = 'variant') {
  if (typeof value?.content !== 'string') return null;
  const errorDetail = String(value.errorDetail || '')
    .split('\n')
    .filter((line) => !/^history sync:/i.test(line.trim()))
    .join('\n')
    .trim()
    .slice(0, MAX_CONTENT);
  const finishReason = String(value.finish_reason || '').trim().slice(0, 80);
  const modelId = String(value.model_id || '').trim().slice(0, 180);
  const usage = normalizeUsage(value.usage);
  const generationSource = GENERATION_SOURCES.has(value.generation_source) ? value.generation_source : '';
  const dogtalkSnapshotId = value.dogtalk_snapshot_id
    ? sanitizeId(value.dogtalk_snapshot_id, 'dogtalk_snapshot')
    : '';
  const messageSource = MESSAGE_SOURCES.has(value.message_source) ? value.message_source : '';
  const displayAuthor = clip(value.display_author, 180).trim();
  const sourceModelLabel = clip(value.source_model_label || value.model_label, 180).trim();
  const furnitureRuns = sanitizeFurnitureRuns(value.furniture_runs);
  const attachments = normalizeAttachments(value.attachments);
  const deskSlip = normalizeDeskSlip(value.desk_slip);
  return {
    id: sanitizeId(value.id || crypto.randomUUID(), prefix),
    content: String(value.content),
    created_at: typeof value.created_at === 'string' ? value.created_at : new Date().toISOString(),
    liked: Boolean(value.liked),
    favorite: Boolean(value.favorite),
    ...(value.hidden === true ? { hidden: true } : {}),
    ...(value.input_type === 'landing_letter' ? { input_type: 'landing_letter' } : {}),
    ...(modelId ? { model_id: modelId } : {}),
    ...(usage ? { usage } : {}),
    ...(finishReason ? { finish_reason: finishReason } : {}),
    ...(generationSource ? { generation_source: generationSource } : {}),
    ...(dogtalkSnapshotId ? { dogtalk_snapshot_id: dogtalkSnapshotId } : {}),
    ...(messageSource ? { message_source: messageSource } : {}),
    ...(displayAuthor ? { display_author: displayAuthor } : {}),
    ...(sourceModelLabel ? { source_model_label: sourceModelLabel } : {}),
    ...(furnitureRuns.length ? { furniture_runs: furnitureRuns } : {}),
    ...(attachments.length ? { attachments } : {}),
    ...(deskSlip ? { desk_slip: deskSlip } : {}),
    ...(errorDetail ? { errorDetail } : {}),
  };
}

function normalizeTurn(value = {}) {
  const userVariants = (Array.isArray(value?.user?.variants) ? value.user.variants : [])
    .map((variant) => normalizeVariant(variant, 'user_variant'))
    .filter(Boolean)
    .slice(0, 20);
  const branchCount = Math.max(1, userVariants.length);
  const variantsByUserVariant = {};
  const activeByUserVariant = {};

  for (let index = 0; index < branchCount; index += 1) {
    const key = String(index);
    const assistants = Array.isArray(value?.assistant?.variantsByUserVariant?.[key])
      ? value.assistant.variantsByUserVariant[key]
      : [];
    variantsByUserVariant[key] = assistants
      .map((variant) => normalizeVariant(variant, 'assistant_variant'))
      .filter(Boolean)
      .slice(0, 20);
    activeByUserVariant[key] = clamp(
      value?.assistant?.activeByUserVariant?.[key],
      variantsByUserVariant[key].length || 1,
    );
  }

  const turnType = value.turn_type === 'landing' ? 'landing' : '';
  const modelId = turnType ? clip(value.model_id, 180) : '';
  return {
    id: sanitizeId(value.id || crypto.randomUUID(), 'turn'),
    ...(turnType ? { turn_type: turnType, model_id: modelId } : {}),
    user: {
      active: clamp(value?.user?.active, userVariants.length || 1),
      variants: userVariants,
    },
    assistant: { activeByUserVariant, variantsByUserVariant },
  };
}

function keepCurrentDeskSlip(turns) {
  let current = null;
  for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = turns[turnIndex];
    const userIndex = clamp(turn?.user?.active, turn?.user?.variants?.length || 1);
    const key = String(userIndex);
    const assistants = turn?.assistant?.variantsByUserVariant?.[key] || [];
    if (!assistants.length) continue;
    const assistantIndex = clamp(turn?.assistant?.activeByUserVariant?.[key], assistants.length || 1);
    current = assistants[assistantIndex] || null;
    break;
  }
  for (const turn of turns) {
    for (const assistants of Object.values(turn?.assistant?.variantsByUserVariant || {})) {
      for (const variant of assistants) {
        if (variant !== current) delete variant.desk_slip;
      }
    }
  }
}

export function normalizeState(value = {}) {
  const raw = value?.history || value || {};
  const turns = (Array.isArray(raw.turns) ? raw.turns : [])
    .map(normalizeTurn)
    .filter((turn) => turn.user.variants.length || Object.values(turn.assistant.variantsByUserVariant).some((list) => list.length))
    .slice(-MAX_TURNS);
  keepCurrentDeskSlip(turns);
  return {
    version: 4,
    updated_at: typeof raw.updated_at === 'string' ? raw.updated_at : new Date().toISOString(),
    turns,
  };
}

function normalizeStringList(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === 'string').map((item) => item.slice(0, 180)).slice(0, 60)
    : [];
}

export function normalizeProfile(value = {}) {
  const avatar = clip(value.assistant_avatar_dataurl ?? value.assistantAvatarDataUrl ?? '', MAX_AVATAR + 1);
  if (avatar.length > MAX_AVATAR) {
    throw new ChatStoreError('profile_avatar_too_large', '头像数据过大，未写入服务器。', 413);
  }
  const modelBox = value.model_box || value.modelBox || {};
  return {
    assistant_avatar_dataurl: avatar,
    current_chat_model: clip(value.current_chat_model ?? value.currentChatModel ?? '', 180),
    current_image_model: clip(value.current_image_model ?? value.currentImageModel ?? '', 180),
    model_box: {
      chat: normalizeStringList(modelBox.chat),
      free: normalizeStringList(modelBox.free),
      image: normalizeStringList(modelBox.image),
    },
  };
}

function emptyProfile() {
  return {
    assistant_avatar_dataurl: '',
    current_chat_model: '',
    current_image_model: '',
    model_box: { chat: [], free: [], image: [] },
  };
}

export async function readProfile(db) {
  await ensureChatSchema(db);
  const row = await first(db, `SELECT assistant_avatar_dataurl, current_chat_model, current_image_model, model_box_json
    FROM chat_profiles WHERE user_id = ?`, [USER_ID]);
  if (!row) return emptyProfile();
  let modelBox = {};
  try {
    modelBox = JSON.parse(row.model_box_json || '{}');
  } catch {
    modelBox = {};
  }
  return normalizeProfile({
    assistant_avatar_dataurl: row.assistant_avatar_dataurl || '',
    current_chat_model: row.current_chat_model || '',
    current_image_model: row.current_image_model || '',
    model_box: modelBox,
  });
}

export async function writeProfile(db, value) {
  await ensureChatSchema(db);
  const profile = normalizeProfile(value || {});
  const timestamp = nowMs();
  await run(db, `INSERT INTO chat_profiles (
      user_id, assistant_avatar_dataurl, current_chat_model, current_image_model, model_box_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      assistant_avatar_dataurl = excluded.assistant_avatar_dataurl,
      current_chat_model = excluded.current_chat_model,
      current_image_model = excluded.current_image_model,
      model_box_json = excluded.model_box_json,
      updated_at = excluded.updated_at`, [
    USER_ID,
    profile.assistant_avatar_dataurl || null,
    profile.current_chat_model || null,
    profile.current_image_model || null,
    JSON.stringify(profile.model_box),
    timestamp,
  ]);
  return profile;
}

async function conversationRow(db, conversationId) {
  return first(db, `SELECT id, title, room_type, created_at, updated_at, deleted_at, title_manual, title_generated_at, title_model_id, source, source_window_id
    FROM conversations WHERE id = ? AND user_id = ?`, [conversationId, USER_ID]);
}

async function requireActiveConversation(db, conversationId) {
  const row = await conversationRow(db, conversationId);
  if (!row) throw new ChatStoreError('conversation_not_found', '聊天窗口不存在。', 404);
  if (row.deleted_at) throw new ChatStoreError('conversation_deleted', '这个聊天窗口已经删除。', 410);
  return row;
}

export async function getConversation(db, id) {
  await ensureChatSchema(db);
  return conversationFromRow(await requireActiveConversation(db, sanitizeId(id, 'conversation')));
}

export async function listConversations(db) {
  await ensureChatSchema(db);
  const rows = await all(db, `SELECT id, title, room_type, created_at, updated_at, deleted_at, title_manual, title_generated_at, title_model_id, source, source_window_id
    FROM conversations
    WHERE user_id = ? AND deleted_at IS NULL AND conversation_kind = 'chat'
    ORDER BY updated_at DESC, created_at DESC`, [USER_ID]);
  return rows.map(conversationFromRow);
}

export async function createConversation(db, title = '新聊天', roomType = 'main') {
  await ensureChatSchema(db);
  const room_type = normalizeRoomType(roomType);
  const timestamp = nowMs();
  const id = sanitizeId(crypto.randomUUID(), 'conversation');
  const cleanTitle = sanitizeTitle(title);
  await run(db, `INSERT INTO conversations (
    id, user_id, title, created_at, updated_at, deleted_at, title_manual,
    title_generated_at, title_model_id, conversation_kind, room_type, source, source_window_id
  ) VALUES (?, ?, ?, ?, ?, NULL, 0, NULL, NULL, 'chat', ?, 'coast', NULL)`, [id, USER_ID, cleanTitle, timestamp, timestamp, room_type]);
  await writeStateRow(db, id, normalizeState(), timestamp);
  return conversationFromRow({
    id,
    title: cleanTitle,
    room_type,
    created_at: timestamp,
    updated_at: timestamp,
    deleted_at: null,
    title_manual: 0,
    title_generated_at: null,
    title_model_id: null,
    source: 'coast',
    source_window_id: null,
  });
}

export async function latestConversationByType(db, roomType) {
  await ensureChatSchema(db);
  const type = normalizeRoomType(roomType);
  const row = await first(db, `SELECT id, title, room_type, created_at, updated_at, deleted_at, title_manual, title_generated_at, title_model_id, source, source_window_id
    FROM conversations WHERE user_id = ? AND deleted_at IS NULL AND conversation_kind = 'chat' AND room_type = ?
    ORDER BY updated_at DESC, created_at DESC LIMIT 1`, [USER_ID, type]);
  return conversationFromRow(row);
}

export async function renameConversation(db, id, title) {
  await ensureChatSchema(db);
  const conversationId = sanitizeId(id, 'conversation');
  await requireActiveConversation(db, conversationId);
  const timestamp = nowMs();
  await run(db, `UPDATE conversations
    SET title = ?, title_manual = 1, updated_at = ?
    WHERE id = ? AND user_id = ? AND deleted_at IS NULL`, [
    sanitizeTitle(title), timestamp, conversationId, USER_ID,
  ]);
  return conversationFromRow(await requireActiveConversation(db, conversationId));
}

export async function setGeneratedTitle(db, id, title, modelId = '') {
  await ensureChatSchema(db);
  const conversationId = sanitizeId(id, 'conversation');
  await requireActiveConversation(db, conversationId);
  const timestamp = nowMs();
  await run(db, `UPDATE conversations
    SET title = ?, title_generated_at = ?, title_model_id = ?, updated_at = ?
    WHERE id = ? AND user_id = ? AND deleted_at IS NULL
      AND (title_manual IS NULL OR title_manual != 1)
      AND title_generated_at IS NULL`, [
    sanitizeTitle(title), timestamp, clip(modelId, 180).trim() || null, timestamp, conversationId, USER_ID,
  ]);
  return conversationFromRow(await requireActiveConversation(db, conversationId));
}

export async function deleteConversation(db, id) {
  await ensureChatSchema(db);
  const conversationId = sanitizeId(id, 'conversation');
  const row = await conversationRow(db, conversationId);
  if (!row) throw new ChatStoreError('conversation_not_found', '聊天窗口不存在。', 404);
  if (row.deleted_at) return conversationFromRow(row);
  const timestamp = nowMs();
  await run(db, `UPDATE conversations SET deleted_at = ?, updated_at = ?
    WHERE id = ? AND user_id = ? AND deleted_at IS NULL`, [timestamp, timestamp, conversationId, USER_ID]);
  return conversationFromRow(await conversationRow(db, conversationId));
}

async function writeStateRow(db, conversationId, state, timestamp = nowMs()) {
  await run(db, `INSERT INTO conversation_states (conversation_id, state_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(conversation_id) DO UPDATE SET
      state_json = excluded.state_json,
      updated_at = excluded.updated_at`, [conversationId, JSON.stringify(normalizeState(state)), timestamp]);
}

export async function readConversationState(db, id) {
  await ensureChatSchema(db);
  const conversationId = sanitizeId(id, 'conversation');
  await requireActiveConversation(db, conversationId);
  const row = await first(db, 'SELECT state_json, updated_at FROM conversation_states WHERE conversation_id = ?', [conversationId]);
  if (!row?.state_json) {
    throw new ChatStoreError('conversation_state_missing', '聊天记录不存在，未创建替代数据。', 500);
  }
  try {
    return normalizeState(JSON.parse(row.state_json));
  } catch {
    throw new ChatStoreError('conversation_state_corrupt', '聊天记录格式损坏，未覆盖原数据。', 500);
  }
}

export async function writeConversationState(db, id, value) {
  await ensureChatSchema(db);
  const conversationId = sanitizeId(id, 'conversation');
  await requireActiveConversation(db, conversationId);
  const state = normalizeState(value);
  const timestamp = nowMs();
  await writeStateRow(db, conversationId, state, timestamp);
  await run(db, `UPDATE conversations SET updated_at = ?
    WHERE id = ? AND user_id = ? AND deleted_at IS NULL`, [timestamp, conversationId, USER_ID]);
  state.updated_at = iso(timestamp);
  return state;
}

async function listActiveMessages(db) {
  await ensureChatSchema(db);
  const rows = await all(db, `SELECT c.id AS conversation_id, c.title, c.room_type, s.state_json
    FROM conversations c
    JOIN conversation_states s ON s.conversation_id = c.id
    WHERE c.user_id = ? AND c.deleted_at IS NULL AND c.conversation_kind = 'chat' AND c.source != 'rikkahub'
    ORDER BY c.updated_at ASC`, [USER_ID]);
  const messages = [];

  for (const row of rows) {
    let state;
    try {
      state = JSON.parse(row.state_json || '{}');
    } catch {
      continue;
    }
    for (const turn of Array.isArray(state?.turns) ? state.turns : []) {
      const users = Array.isArray(turn?.user?.variants) ? turn.user.variants : [];
      const userIndex = clamp(turn?.user?.active, users.length || 1);
      const user = users[userIndex];
      const assistants = Array.isArray(turn?.assistant?.variantsByUserVariant?.[String(userIndex)])
        ? turn.assistant.variantsByUserVariant[String(userIndex)]
        : [];
      const assistantIndex = clamp(
        turn?.assistant?.activeByUserVariant?.[String(userIndex)],
        assistants.length || 1,
      );
      const assistant = assistants[assistantIndex];
      for (const [role, variant] of [['user', user], ['assistant', assistant]]) {
        const createdAt = Date.parse(String(variant?.created_at || ''));
        if (!Number.isFinite(createdAt) || createdAt <= 0 || typeof variant?.content !== 'string' || !variant.content.trim()) continue;
        messages.push({
          conversation_id: row.conversation_id,
          conversation_title: row.title || '新聊天',
          room_type: normalizeRoomType(row.room_type || 'main'),
          turn_id: turn.id || null,
          variant_id: variant.id || null,
          role,
          content: variant.content.slice(0, MAX_CONTENT),
          created_at: new Date(createdAt).toISOString(),
        });
      }
    }
  }
  return messages.sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at));
}

function landingFromRow(row) {
  if (!row) return { sent: false };
  return {
    sent: true,
    model_id: row.model_id,
    landing_version: Number(row.landing_version || 0),
    landing_text_hash: row.letter_hash,
    assistant_turn_id: row.assistant_turn_id,
    sent_at: iso(row.sent_at),
  };
}

export async function readLandingStatus(db, id, model) {
  await ensureChatSchema(db);
  const conversationId = sanitizeId(id, 'conversation');
  await requireActiveConversation(db, conversationId);
  const modelId = clip(model, 180).trim();
  if (!modelId) throw new ChatStoreError('invalid_request', '没有可递信的当前模型。', 400);
  const row = await first(db, `SELECT model_id, letter_hash, assistant_turn_id, landing_version, sent_at
    FROM conversation_landing_letters
    WHERE conversation_id = ? AND model_id = ?
    ORDER BY landing_version DESC
    LIMIT 1`, [conversationId, modelId]);
  return landingFromRow(row);
}

export async function writeLandingExchange(db, id, value = {}) {
  await ensureChatSchema(db);
  const conversationId = sanitizeId(id, 'conversation');
  await requireActiveConversation(db, conversationId);
  const modelId = clip(value.model_id, 180).trim();
  const assistantModelId = clip(value.assistant_model_id || modelId, 180).trim();
  const letterText = clip(value.letter_text);
  const letterHash = clip(value.letter_hash, 128).trim();
  const assistantText = String(value.assistant_text ?? '');
  const finishReason = clip(value.finish_reason, 80).trim();
  const usage = normalizeUsage(value.usage);
  const furnitureRuns = sanitizeFurnitureRuns(value.furniture_runs);
  const deskSlip = normalizeDeskSlip(value.desk_slip);
  if (!modelId || !letterText.trim() || !letterHash || !assistantText.trim()) {
    throw new ChatStoreError('invalid_request', '登岛信或模型回复不完整。', 400);
  }

  const state = normalizeState(value.state);
  const timestamp = nowMs();
  const createdAt = iso(timestamp);
  const turnId = sanitizeId(crypto.randomUUID(), 'landing_turn');
  const userVariantId = sanitizeId(crypto.randomUUID(), 'landing_user');
  const assistantVariantId = sanitizeId(crypto.randomUUID(), 'landing_assistant');
  state.turns.push(normalizeTurn({
    id: turnId,
    turn_type: 'landing',
    model_id: modelId,
    user: {
      active: 0,
      variants: [{
        id: userVariantId,
        content: letterText,
        hidden: true,
        input_type: 'landing_letter',
        created_at: createdAt,
      }],
    },
    assistant: {
      activeByUserVariant: { 0: 0 },
      variantsByUserVariant: { 0: [{
        id: assistantVariantId,
        content: assistantText,
        created_at: createdAt,
        ...(assistantModelId ? { model_id: assistantModelId } : {}),
        ...(usage ? { usage } : {}),
        ...(finishReason ? { finish_reason: finishReason } : {}),
        ...(furnitureRuns.length ? { furniture_runs: furnitureRuns } : {}),
        ...(deskSlip ? { desk_slip: deskSlip } : {}),
        generation_source: 'landing',
      }] },
    },
  }));
  state.turns = state.turns.slice(-MAX_TURNS);
  keepCurrentDeskSlip(state.turns);
  state.updated_at = createdAt;

  const latest = await first(db, `SELECT MAX(landing_version) AS version
    FROM conversation_landing_letters
    WHERE conversation_id = ? AND model_id = ?`, [conversationId, modelId]);
  const landingVersion = Number(latest?.version || 0) + 1;
  const landingId = sanitizeId(crypto.randomUUID(), 'landing_letter');
  const statements = [
    db.prepare(`INSERT INTO conversation_landing_letters (
      id, conversation_id, model_id, letter_text, letter_hash, assistant_turn_id,
      landing_version, sent_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(landingId, conversationId, modelId, letterText, letterHash, turnId, landingVersion, timestamp, timestamp, timestamp),
    db.prepare(`INSERT INTO conversation_states (conversation_id, state_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(conversation_id) DO UPDATE SET
        state_json = excluded.state_json,
        updated_at = excluded.updated_at`)
      .bind(conversationId, JSON.stringify(state), timestamp),
    db.prepare(`UPDATE conversations SET updated_at = ?
      WHERE id = ? AND user_id = ? AND deleted_at IS NULL`)
      .bind(timestamp, conversationId, USER_ID),
  ];
  await db.batch(statements);

  return {
    state,
    assistant: {
      role: 'assistant',
      content: assistantText,
      id: assistantVariantId,
      ...(assistantModelId ? { model_id: assistantModelId } : {}),
      ...(usage ? { usage } : {}),
      ...(finishReason ? { finish_reason: finishReason } : {}),
      ...(deskSlip ? { desk_slip: deskSlip } : {}),
      generation_source: 'landing',
    },
    landing: landingFromRow({
      model_id: modelId,
      letter_hash: letterHash,
      assistant_turn_id: turnId,
      landing_version: landingVersion,
      sent_at: timestamp,
    }),
  };
}

import { ensureChatSchema, listConversations, readConversationState, normalizeState, normalizeContextSettings } from './chat-store.js';
import { bytes, object, requireTransfer, hashTransferText, encodeTransfer, decodeTransfer, TRANSFER_CLOUD_LIMIT } from './transfer-codec.js';

export const TRANSFER_CHAT_LIMIT = 40;
export const TRANSFER_STATE_LIMIT = 1536 * 1024;
const ID = /^[A-Za-z0-9_.:-]{1,160}$/;
const own = (value, key) => Object.hasOwn(value, key);
const validId = value => typeof value === 'string' && ID.test(value);
const required = (value, message) => requireTransfer(value, message, 'invalid_chat_transfer');
function ids(values) { required(values.every(validId) && new Set(values).size === values.length, '存在无效或重复的聊天 ID。'); }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (object(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function same(a,b) { return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b)); }
function countOmitted(row, allowed, prefix, warnings) {
  for (const [key, value] of Object.entries(row)) {
    if (allowed.includes(key) || value == null || value === '' || value === false ||
        (Array.isArray(value) && value.length === 0) || (object(value) && Object.keys(value).length === 0)) continue;
    const name = prefix + key;
    warnings[name] = (warnings[name] || 0) + 1;
  }
}
const CONVERSATION_KEYS = ['id','title','room_type','created_at','updated_at','source','source_window_id'];
const VARIANT_KEYS = ['id','content','created_at','liked','favorite','hidden','model_id','finish_reason','generation_source','display_author','errorDetail'];
function variant(value, warnings) {
  required(object(value) && validId(value.id) && typeof value.content === 'string' && typeof value.created_at === 'string', '消息缺少 ID、原文或时间。');
  const next = { id: value.id, content: value.content, created_at: value.created_at, liked: false, favorite: false, hidden: false };
  for (const key of ['liked','favorite','hidden']) {
    required(value[key] === undefined || typeof value[key] === 'boolean', '消息标志无效。');
    if (own(value,key)) next[key] = value[key];
  }
  for (const key of VARIANT_KEYS.slice(6)) {
    required(value[key] == null || typeof value[key] === 'string', '消息来源或模型信息无效。');
    if (value[key]) next[key] = value[key];
  }
  countOmitted(value, VARIANT_KEYS, 'message.', warnings);
  return next;
}
function projectRecord(row, warnings) {
  required(object(row) && object(row.conversation) && object(row.history), '窗口或历史缺失。');
  const c = row.conversation, h = row.history;
  required(validId(c.id) && typeof c.title === 'string' && c.title.trim().length > 0 &&
    ['main','radio','lighthouse'].includes(c.room_type), '窗口名称或类型无效。');
  required(typeof c.created_at === 'string' && Number.isFinite(Date.parse(c.created_at)) &&
    typeof c.updated_at === 'string' && Number.isFinite(Date.parse(c.updated_at)), '窗口时间无效。');
  required(c.source == null || typeof c.source === 'string', '窗口来源无效。');
  required(c.source_window_id == null || validId(c.source_window_id), '原窗口 ID 无效。');
  required(h.version === 4 && (h.conversation_id == null || h.conversation_id === c.id) &&
    typeof h.updated_at === 'string' && object(h.context_settings) && Array.isArray(h.turns), '聊天历史版本或归属无效。');
  required(h.turns.length <= 400, '目标云端每窗最多 400 轮；请先分包或等待大窗口迁移支持，未截断原文。');
  const conversation = { id:c.id, title:c.title, room_type:c.room_type, created_at:c.created_at, updated_at:c.updated_at,
    source:c.source || 'coast', source_window_id:c.source_window_id || null };
  countOmitted(c, CONVERSATION_KEYS, 'conversation.', warnings);
  countOmitted(row, ['conversation','history'], 'record.', warnings);
  countOmitted(h, ['version','updated_at','context_settings','turns','conversation_id'], 'history.', warnings);
  const settings = normalizeContextSettings(h.context_settings);
  required(same(settings, h.context_settings), '窗口上下文设置不能无损转换。');
  ids(h.turns.map(t => t?.id));
  const turns = h.turns.map(t => {
    required(object(t) && object(t.user) && object(t.assistant) && Array.isArray(t.user.variants) &&
      object(t.assistant.variantsByUserVariant) && object(t.assistant.activeByUserVariant), '轮次或变体结构无效。');
    const u = t.user, a = t.assistant;
    required(u.variants.length <= 20 && Number.isInteger(u.active) &&
      (u.variants.length ? u.active >= 0 && u.active < u.variants.length : u.active === 0), '用户变体数或活动索引超出目标限制。');
    const count = Math.max(1, u.variants.length);
    const keys = Object.keys(a.variantsByUserVariant);
    const validKey = key => /^(0|[1-9][0-9]*)$/.test(key) && Number(key) < count;
    required(keys.every(validKey) && Object.keys(a.activeByUserVariant).every(validKey), '助手变体分支无效。');
    const variantsByUserVariant = {}, activeByUserVariant = {};
    for (let i = 0; i < count; i++) {
      const key = String(i), list = a.variantsByUserVariant[key] || [], active = a.activeByUserVariant[key] ?? 0;
      required(Array.isArray(list) && list.length <= 20 && Number.isInteger(active) &&
        (list.length ? active >= 0 && active < list.length : active === 0), '助手变体数或活动索引超出目标限制。');
      variantsByUserVariant[key] = list.map(v => variant(v, warnings));
      activeByUserVariant[key] = active;
    }
    const user = { active:u.active, variants:u.variants.map(v => variant(v,warnings)) };
    const assistant = { activeByUserVariant, variantsByUserVariant };
    const all = [...user.variants, ...Object.values(variantsByUserVariant).flat()];
    required(all.length > 0, '空轮次不能无损导入。');
    ids(all.map(v => v.id));
    const result = { id:t.id, user, assistant };
    required(t.turn_type == null || t.turn_type === '' || t.turn_type === 'landing', '轮次类型不能无损转换。');
    if (t.turn_type === 'landing') { result.turn_type = 'landing'; result.model_id = t.model_id || ''; }
    countOmitted(t, ['id','user','assistant','turn_type','model_id'], 'turn.', warnings);
    countOmitted(u, ['active','variants'], 'user.', warnings);
    countOmitted(a, ['activeByUserVariant','variantsByUserVariant'], 'assistant.', warnings);
    return result;
  });
  return { conversation, history:{ version:4, updated_at:h.updated_at, context_settings:settings, turns, conversation_id:c.id } };
}
function normalizeRecord(record) {
  const normalized = normalizeState(record.history);
  const projected = projectRecord({ conversation:record.conversation, history:normalized }, Object.create(null));
  required(same(record.history, projected.history), '云端规范化会改变原始聊天，已拒绝导入。');
  requireTransfer(bytes(JSON.stringify(normalized)) <= TRANSFER_STATE_LIMIT, '单窗口超过云端 1.5 MiB 安全写入上限。', 'transfer_state_too_large', 413);
  return normalized;
}
async function loadRecords(db, payload) {
  const chat = payload.modules.chat;
  required(object(chat) && Array.isArray(chat.conversations) && chat.conversations.length > 0 &&
    chat.conversations.length <= TRANSFER_CHAT_LIMIT, '每次云端导入须包含 1—40 个聊天窗口。');
  const warnings = Object.create(null);
  const records = chat.conversations.map(row => projectRecord(row, warnings));
  ids(records.map(row => row.conversation.id));
  const unselected = Object.keys(payload.modules).filter(key => key !== 'chat');
  const planned = [];
  for (const row of records) {
    const state = normalizeRecord(row);
    const digest = await hashTransferText(JSON.stringify(canonical(row)));
    const id = 'transfer_' + digest;
    const existing = await db.prepare('SELECT source_window_id, deleted_at FROM conversations WHERE id = ?').bind(id).first();
    // Never overwrite even a previously imported window that was subsequently edited or deleted.
    required(!existing || existing.source_window_id === row.conversation.id, '目标窗口 ID 已被其他资料占用。');
    planned.push({ row, state, id, duplicate: Boolean(existing), deleted: Boolean(existing?.deleted_at) });
  }
  return { planned, warnings, unselected };
}
function summary(plan) {
  return {
    conversations:plan.planned.length,
    turns:plan.planned.reduce((n,x) => n+x.row.history.turns.length,0),
    variants:plan.planned.reduce((n,x) => n+x.row.history.turns.reduce((m,t)=>m+t.user.variants.length+Object.values(t.assistant.variantsByUserVariant).flat().length,0),0),
    new_conversations:plan.planned.filter(x=>!x.duplicate).length,
    previously_imported:plan.planned.filter(x=>x.duplicate).length,
    deleted_previously_imported:plan.planned.filter(x=>x.deleted).length,
    omitted_fields:plan.warnings, unselected_modules:plan.unselected,
    strategy:'copy_without_overwrite',
  };
}
export async function exportTransferChat(db, idsToExport = []) {
  const all = await listConversations(db);
  const selected = idsToExport.length ? all.filter(c=>idsToExport.includes(c.id)) : all;
  required(!idsToExport.length || selected.length === new Set(idsToExport).size, '找不到部分所选窗口。');
  required(selected.length > 0 && selected.length <= TRANSFER_CHAT_LIMIT, '请选择 1—40 个窗口导出。');
  const records = [];
  // Keep full state (including metadata) in the package; the destination preview explicitly reports unsupported fields.
  for (const c of selected) records.push({ conversation:c, history:{...await readConversationState(db,c.id),conversation_id:c.id} });
  const bundle = await encodeTransfer({ source:{application:'coast-web',mode:'backend'}, exported_at:new Date().toISOString(),
    modules:{chat:{conversations:records}}, excluded_modules:['daily','calendar','model_profile','memory','worldbook','thinking_soil','vault','library','attachment_binary','voice','credentials','provider_configuration'] });
  requireTransfer(bytes(JSON.stringify(bundle)) <= TRANSFER_CLOUD_LIMIT - 1024, '所选窗口数据包超过云端单次 8 MiB 上限，请减少窗口数量。', 'transfer_too_large', 413);
  return bundle;
}
export async function previewTransferChat(db, bundle) {
  const payload = await decodeTransfer(bundle);
  await ensureChatSchema(db);
  return summary(await loadRecords(db,payload));
}
export async function importTransferChat(db, bundle, { confirm = false, acceptOmissions = false } = {}) {
  required(confirm === true, '导入需明确确认。');
  const payload = await decodeTransfer(bundle);
  await ensureChatSchema(db);
  const plan = await loadRecords(db,payload);
  required(acceptOmissions === true || (!Object.keys(plan.warnings).length && !plan.unselected.length),
    '存在未导入模块或字段，须预览并明确确认。');
  const statements = [];
  for (const {row,state,id,duplicate} of plan.planned) {
    if (duplicate) continue;
    const c = row.conversation;
    statements.push(db.prepare(`INSERT INTO conversations
      (id,user_id,title,created_at,updated_at,deleted_at,title_manual,title_generated_at,title_model_id,conversation_kind,room_type,source,source_window_id)
      VALUES (?, 'owner', ?, ?, ?, NULL, 1, NULL, NULL, 'chat', ?, 'coast', ?)`)
      .bind(id,c.title,Date.parse(c.created_at),Date.parse(c.updated_at),c.room_type,c.id));
    statements.push(db.prepare('INSERT INTO conversation_states (conversation_id,state_json,updated_at) VALUES (?,?,?)')
      .bind(id,JSON.stringify(state),Date.parse(c.updated_at)));
  }
  // Single D1 atomic batch: a concurrent duplicate or any error rolls back the entire import.
  if (statements.length) await db.batch(statements);
  return {...summary(plan), imported_conversation_ids:plan.planned.filter(x=>!x.duplicate).map(x=>x.id)};
}

import { ensureChatSchema, listConversations, readConversationState, normalizeState, normalizeProfile, readProfile } from './chat-store.js';
import { exportDailyTransfer, prepareDailyTransfer } from './coast-transfer-daily.js';
import { ensureCalendarSchema, listCalendarEntries } from './calendar-store.js';
import { anniversaryCalendarDay } from './calendar-anniversary.js';
import { encodeTransfer, decodeTransfer, byteLength, CLOUD_IMPORT_LIMIT, TransferError } from './coast-transfer.js';

const OWNER_AUTHOR = 'owner';
const ASSISTANT_AUTHOR = 'assistant';
const WEB_MESSAGE_SOURCE = 'owner_web';
const APP_ID = 'com.elementeracoast.source';
const SUPPORTED = ['chat', 'calendar', 'daily', 'model_profile'];
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(value);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && (() => { try { return anniversaryCalendarDay({startDay:value,mode:'elapsed'}) === value; } catch { return false; } })();
const stamp = value => typeof value === 'number' ? value : Date.parse(value);
const validStamp = value => Number.isSafeInteger(stamp(value)) && stamp(value) >= 0;
const require = (ok, message) => { if (!ok) throw new TransferError('invalid_transfer_record', message); };
const identical = (a,b) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (object(v)) return Object.fromEntries(Object.keys(v).sort().map(k => [k,sortKeys(v[k])]));
  return v;
}
function canonicalAuthor(value) { return value === OWNER_AUTHOR || value === 'owner' ? 'owner' : 'assistant'; }
function portableHistory(history, id) {
  const h = structuredClone(history);
  h.conversation_id = id;
  for (const t of h.turns) {
    for (const v of [...t.user.variants, ...Object.values(t.assistant.variantsByUserVariant).flat()]) {
      if (v.message_source === WEB_MESSAGE_SOURCE) v.message_source = 'owner_web';
    }
  }
  return h;
}
function portableCalendar(row) {
  return { id: row.id, day: row.day, occurrence_day: row.day, kind: row.kind, title: row.title, body: row.body,
    recurrence: row.recurrence, author: canonicalAuthor(row.author), source: row.source,
    created_at: row.created_at, updated_at: row.updated_at, ...(row.anniversary ? {anniversary:row.anniversary}:{}),
    ...(row.conversation_id ? {conversation_id:row.conversation_id}:{}),
    ...(row.source_turn_id ? {source_turn_id:row.source_turn_id}:{}),
    ...(row.model_label != null ? {model_label:row.model_label}:{}),
    ...(row.tool_call_id != null ? {tool_call_id:row.tool_call_id}:{}) };
}
export async function exportCloudTransfer(db) {
  const conversations = [];
  for (const c of await listConversations(db)) {
    conversations.push({ conversation: c, history: portableHistory(await readConversationState(db,c.id),c.id) });
  }
  const profileRow = await db.prepare("SELECT user_id,updated_at FROM chat_profiles WHERE user_id = 'owner'").first();
  return encodeTransfer({ applicationId: APP_ID, workspace:'backend', exportedAt:new Date().toISOString(),
    includedModules:SUPPORTED, conversations, calendar:(await listCalendarEntries(db,{all:true})).map(portableCalendar),
    profile:profileRow ? {...await readProfile(db),updated_at:profileRow.updated_at} : null, ...await exportDailyTransfer(db,APP_ID) });
}

// Keep the original content and branch positions. Never rely on normalizeState's
// truncation or clamping as validation. Unsupported media must block that window.
export function validatedChat(row,{verifiedMediaGroup=false}={}) {
  require(object(row?.conversation) && object(row?.history), '聊天记录结构无效。');
  const c = row.conversation, h = row.history;
  require(validId(c.id) && typeof c.title === 'string' && c.title.trim() && c.title.length <= 1000, '窗口名称或 ID 无效。');
  require(['main','radio','lighthouse'].includes(c.room_type) && validStamp(c.created_at) && validStamp(c.updated_at), '窗口类型或时间无效。');
  require(!c.deleted_at, '已删除窗口不能直接恢复为活动窗口。');
  require(c.title_manual == null || typeof c.title_manual === 'boolean', '标题来源标记无效。');
  require(c.title_generated_at == null || validStamp(c.title_generated_at), '标题生成时间无效。');
  require(c.title_model_id == null || typeof c.title_model_id === 'string', '标题模型标记无效。');
  require(c.source == null || (typeof c.source === 'string' && c.source.trim() === c.source && c.source.length <= 160), '窗口来源无效。');
  require(c.source_window_id == null || typeof c.source_window_id === 'string', '窗口来源 ID 无效。');
  require(h.version === 4 && h.conversation_id === c.id && Array.isArray(h.turns) && validStamp(h.updated_at), '历史版本、所属窗口或时间无效。');
  require(h.turns.length <= 400, '目标后端每个窗口最多 400 轮；该窗口未截断。');
  const turnIds = new Set();
  const variantIds = new Set();
  for (const t of h.turns) {
    require(validId(t?.id) && !turnIds.has(t.id), '轮次 ID 重复或无效。'); turnIds.add(t.id);
    const u = t.user, a = t.assistant;
    require(object(u) && Array.isArray(u.variants) && object(a?.variantsByUserVariant) && object(a?.activeByUserVariant), '聊天分支结构无效。');
    require(u.variants.length <= 20 && Number.isInteger(u.active) && u.active >= 0 && u.active < Math.max(1,u.variants.length), '用户分支超限或活动索引无效。');
    const keys = new Set([...Object.keys(a.variantsByUserVariant),...Object.keys(a.activeByUserVariant)]);
    for (const key of keys) {
      require(/^(0|[1-9]\d*)$/.test(key) && Number(key) < Math.max(1,u.variants.length), '助手分支所属用户变体无效。');
      const v = a.variantsByUserVariant[key] || [], active = a.activeByUserVariant[key] ?? 0;
      require(Array.isArray(v) && v.length <= 20 && Number.isInteger(active) && active >= 0 && active < Math.max(1,v.length), '助手分支超限或活动索引无效。');
    }
    const variants = [...u.variants,...Object.values(a.variantsByUserVariant).flat()];
    require(variants.length > 0, '空轮次不能无损导入目标后端。');
    for (const v of variants) {
      require(validId(v?.id) && !variantIds.has(v.id) && typeof v.content === 'string', '消息 ID 或正文无效。'); variantIds.add(v.id);
      require(typeof v.created_at === 'string' && validStamp(v.created_at), '消息时间无效。');
      require(verifiedMediaGroup||!v.attachments?.length, '含附件的窗口暂不支持迁移原件，请保留原窗口。');
      require(verifiedMediaGroup||!v.dogtalk_snapshot_id, '该窗口关联尚不可迁移的跨窗快照，请保留原窗口。');
    }
  }
  const h2 = structuredClone(h);
  const storageUpdatedAt=h2.archive_storage_updated_at;
  require(storageUpdatedAt==null||(Number.isSafeInteger(storageUpdatedAt)&&storageUpdatedAt>=0),'历史存储时间无效。');
  delete h2.archive_storage_updated_at;
  for (const t of h2.turns) for (const v of [...t.user.variants,...Object.values(t.assistant.variantsByUserVariant).flat()]) {
    if (v.message_source === 'owner_web') v.message_source = WEB_MESSAGE_SOURCE;
    // Native uses explicit null/default fields, which the server omits. Compare meaningful values below.
  }
  // The native local runtime has historically stored a receipt for each
  // reply. Preserve original receipts that the ordinary online latest-only
  // policy would discard, explicitly marking only those archived variants.
  let normalized = normalizeState(h2);
  const byId = new Map(normalized.turns.flatMap(t=>Object.values(t.assistant.variantsByUserVariant).flat()).map(v=>[v.id,v]));
  let retained=false;
  for(const t of h2.turns) for(const v of Object.values(t.assistant.variantsByUserVariant).flat()){
    if(object(v.desk_slip)&&byId.has(v.id)&&!byId.get(v.id).desk_slip){
      v.archive_retained_desk_slip=true;retained=true;
    }
  }
  if(retained)normalized=normalizeState(h2);
  // Do not echo arbitrary JSON keys from an uploaded archive in client errors.
  const safePath = path => {
    const allowed = new Set(['history','turns','user','assistant','variants','variantsByUserVariant','activeByUserVariant','active','id','content','created_at','updated_at','context_settings','reality_enabled','reality_fields','short_reply_mode','weather_city','version','liked','favorite','hidden','model_id','finish_reason','generation_source','message_source','display_author','errorDetail','attachments','furniture_runs','desk_slip','archive_retained_desk_slip','usage','input_type','source_model_label','dogtalk_snapshot_id','turn_type','prompt_tokens','completion_tokens','total_tokens']);
    const parts=path.split('.').map(x=>x.replace(/\[\]/g,''));
    return parts.every(x=>allowed.has(x)||/^\d{1,2}$/.test(x)) ? path : '未识别字段';
  };
  const compare = (raw, next, path = '') => {
    if (raw === null || raw === '' || raw === false || (Array.isArray(raw) && raw.length === 0)) {
      if (next === undefined || identical(raw,next)) return;
    }
    if (object(raw)) {
      require(object(next), '目标不能完整保留字段：'+safePath(path));
      for (const [key,value] of Object.entries(raw)) {
        if (key === 'conversation_id' && path === 'history') continue;
        compare(value,next[key],path+'.'+key);
      }
    } else if (Array.isArray(raw)) {
      require(Array.isArray(next) && raw.length === next.length,'目标不能完整保留数组：'+safePath(path));
      raw.forEach((v,i)=>compare(v,next[i],path+'[]'));
    } else require(identical(raw,next), '目标不能完整保留字段：'+safePath(path));
  };
  compare(h2, normalized, 'history');
  require(byteLength(JSON.stringify(normalized)) <= 1800000, '目标数据库单窗口记录超过安全大小，未截断。');
  return { c, state:normalized, storageUpdatedAt:storageUpdatedAt??stamp(normalized.updated_at) };
}
function validatedCalendar(row) {
  require(object(row) && validId(row.id) && validDate(row.day) && validStamp(row.created_at) && validStamp(row.updated_at), '日历 ID、日期或时间无效。');
  require(typeof row.title === 'string' && row.title.trim() && row.title.length <=120 && typeof row.body === 'string' && row.body.length <=4000, '日历文字超限。');
  require(['event','note'].includes(row.kind) && ['none','yearly'].includes(row.recurrence) && ['owner','assistant'].includes(row.author), '日历类型或作者无效。');
  require((row.conversation_id == null || validId(row.conversation_id)) && (row.source_turn_id == null || (validId(row.source_turn_id) && row.conversation_id != null)), '日历来源窗口或轮次无效。');
  for (const key of ['model_label','tool_call_id']) require(row[key] == null || (typeof row[key] === 'string' && row[key].length <= 200), '日历来源字段无效。');
  if (row.anniversary != null) {
    const a = row.anniversary;
    require(object(a) && typeof a.pinned === 'boolean' && Object.keys(a).every(k=>['startDay','mode','targetDays','pinned'].includes(k)), '纪念日字段无效。');
    let day;
    try { day=anniversaryCalendarDay(a); } catch { throw new TransferError('invalid_transfer_record','纪念日日期无效。'); }
    require(day===row.day && row.kind==='event' && row.recurrence===(a.mode==='yearly'?'yearly':'none'), '纪念日计算与日期不一致。');
  }
  return row;
}
async function prepare(db,envelope,selection) {
  const payload = await decodeTransfer(envelope,CLOUD_IMPORT_LIMIT);
  require(Array.isArray(selection) && selection.length && new Set(selection).size===selection.length && selection.every(k=>SUPPORTED.includes(k)&&payload.includedModules.includes(k)), '请选择目标已支持且包中存在的模块。');
  await ensureChatSchema(db); await ensureCalendarSchema(db);
  const existingChats = new Set((await db.prepare('SELECT id FROM conversations').all()).results.map(r=>r.id));
  const existingCalendar = new Set((await db.prepare('SELECT id FROM coast_calendar_entries_v2').all()).results.map(r=>r.id));
  const activeChats = new Map((await listConversations(db)).map(c=>[c.id,c]));
  const activeCalendar = new Map((await listCalendarEntries(db,{all:true})).map(c=>[c.id,portableCalendar(c)]));
  const result = { source:payload.workspace, target:'backend', unsupported_modules:payload.includedModules.filter(k=>!SUPPORTED.includes(k)), chat:{ready:0,existing:0,conflicts:0,blocked:[]},calendar:{ready:0,existing:0,conflicts:0,blocked:[]},model_profile:{ready:0,existing:0,conflicts:0,blocked:[]},daily:{ready:0,existing:0,conflicts:0,blocked:[]} };
  const statements = [];
  const stagedChatStates = new Map();
  const conflictingChatIds = new Set();
  const seen = new Set();
  for (const row of selection.includes('chat')?payload.conversations:[]) {
    const id=row?.conversation?.id;
    require(validId(id)&&!seen.has(id),'数据包内窗口 ID 重复或无效。');seen.add(id);
    if (existingChats.has(id)) {
      result.chat.existing++;
      const current=activeChats.get(id);
      if (!current || !identical(current,row.conversation) ||
          !identical(portableHistory(await readConversationState(db,id),id),row.history)) { result.chat.conflicts++; conflictingChatIds.add(id); }
      continue;
    }
    let v;
    try { v=validatedChat(row); } catch(e) { if (!(e instanceof TransferError)) throw e; result.chat.blocked.push({id,reason:e.message}); continue; }
    const c=v.c;
    statements.push(db.prepare(`INSERT INTO conversations (id,user_id,title,created_at,updated_at,deleted_at,title_manual,title_generated_at,title_model_id,conversation_kind,room_type,source,source_window_id) VALUES (?,'owner',?,?,?,NULL,?,?,?,'chat',?,?,?)`).bind(c.id,c.title,stamp(c.created_at),stamp(c.updated_at),c.title_manual?1:0,c.title_generated_at==null?null:stamp(c.title_generated_at),c.title_model_id??null,c.room_type,c.source||'coast',c.source_window_id??null));
    statements.push(db.prepare('INSERT INTO conversation_states (conversation_id,state_json,updated_at) VALUES (?,?,?)').bind(c.id,JSON.stringify(v.state),v.storageUpdatedAt));
    stagedChatStates.set(c.id,v.state);
    result.chat.ready++;
  }
  seen.clear();
  const usedCalendarToolIds = new Set((await db.prepare('SELECT tool_call_id FROM coast_calendar_entries_v2 WHERE tool_call_id IS NOT NULL').all()).results.map(r=>r.tool_call_id));
  for (const row of selection.includes('calendar')?payload.calendar:[]) {
    require(validId(row?.id)&&!seen.has(row.id),'数据包内日历 ID 重复或无效。');seen.add(row.id);
    if (existingCalendar.has(row.id)) {
      result.calendar.existing++;
      if (!identical(activeCalendar.get(row.id),row)) result.calendar.conflicts++;
      continue;
    }
    try { validatedCalendar(row); } catch(e) { if (!(e instanceof TransferError)) throw e; result.calendar.blocked.push({id:row.id,reason:e.message}); continue; }
    if (row.conversation_id != null) {
      const parent=row.conversation_id;
      const state=stagedChatStates.get(parent) || (activeChats.has(parent) ? await readConversationState(db,parent) : null);
      if (conflictingChatIds.has(parent) || !state || (row.source_turn_id != null && !state.turns.some(t=>t.id===row.source_turn_id))) {
        result.calendar.blocked.push({id:row.id,reason:'日历关联的原窗口或轮次不存在，或窗口内容冲突。'}); continue;
      }
    }
    if (row.tool_call_id != null) {
      if (usedCalendarToolIds.has(row.tool_call_id)) { result.calendar.blocked.push({id:row.id,reason:'日历工具调用 ID 已存在；原记录保留。'}); continue; }
      usedCalendarToolIds.add(row.tool_call_id);
    }
    const a=row.anniversary;
    statements.push(db.prepare(`INSERT INTO coast_calendar_entries_v2 (id,day,kind,title,body,recurrence,author,source,model_label,tool_call_id,conversation_id,source_turn_id,created_at,updated_at,anniversary_start_day,anniversary_mode,anniversary_target_days,anniversary_pinned) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(row.id,row.day,row.kind,row.title,row.body,row.recurrence,row.author==='owner'?OWNER_AUTHOR:ASSISTANT_AUTHOR,row.source||'manual',row.model_label??null,row.tool_call_id??null,row.conversation_id??null,row.source_turn_id??null,stamp(row.created_at),stamp(row.updated_at),a?.startDay??null,a?.mode??null,a?.targetDays??null,a?.pinned?1:0));
    result.calendar.ready++;
  }
  if (selection.includes('model_profile') && payload.profile !== null) {
    const row=payload.profile, report=result.model_profile;
    const {updated_at:profileTime,...body}=row;
    let normalized;
    try { normalized=normalizeProfile(body); } catch { normalized=null; }
    if (!normalized || !identical(body,normalized) || (profileTime!=null&&(!Number.isSafeInteger(profileTime)||profileTime<0))) {
      report.blocked.push({id:'model_profile',reason:'模型资料字段或长度不兼容，未截断或删除字段。'});
    } else {
      const current=await db.prepare("SELECT user_id,updated_at FROM chat_profiles WHERE user_id = 'owner'").first();
      if (current) {
        report.existing++;
        if (!identical(await readProfile(db),normalized)||(profileTime!=null&&profileTime!==current.updated_at)) report.conflicts++;
      } else {
        statements.push(db.prepare("INSERT INTO chat_profiles (user_id,assistant_avatar_dataurl,current_chat_model,current_image_model,model_box_json,updated_at) VALUES ('owner',?,?,?,?,?)").bind(normalized.assistant_avatar_dataurl||null,normalized.current_chat_model||null,normalized.current_image_model||null,JSON.stringify(normalized.model_box),profileTime??Date.now()));
        report.ready++;
      }
    }
  }
  if (selection.includes('daily')) {
    const daily = await prepareDailyTransfer(db,payload,APP_ID,async row=>{
      require(row.conversation_id!=null||row.source_turn_id==null,'日常来源轮次缺少窗口。');
      if(row.conversation_id==null)return;
      const parent=row.conversation_id;
      const state=stagedChatStates.get(parent)||(activeChats.has(parent)?await readConversationState(db,parent):null);
      require(!conflictingChatIds.has(parent)&&state&&(!row.source_turn_id||state.turns.some(t=>t.id===row.source_turn_id)),'日常关联原窗口或轮次不存在，或窗口内容冲突。');
    });
    result.daily=daily.report;
    statements.push(...daily.statements);
  }
  result.statement_count=statements.length;
  result.can_commit=statements.length<=90 && !result.chat.blocked.length && !result.calendar.blocked.length && !result.model_profile.blocked.length && !result.daily.blocked.length;
  return { result, statements };
}
export async function previewCloudTransfer(db,envelope,selection) { return (await prepare(db,envelope,selection)).result; }
export async function importCloudTransfer(db,envelope,selection) {
  const {result,statements}=await prepare(db,envelope,selection);
  if (!result.can_commit) throw new TransferError('transfer_blocked','存在不兼容记录或本次超过 90 条原子写入上限；未写入任何记录。',409);
  // INSERT (not replace/upsert) prevents a concurrent edit or duplicate from being overwritten.
  if (statements.length) await db.batch(statements);
  return result;
}

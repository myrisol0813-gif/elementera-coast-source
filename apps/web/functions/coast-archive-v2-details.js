import { ensureMemorySchema } from './memory-store/memory-schema.js';
import { ensureUserPortraitSchema } from './memory-store/user-portrait-store.js';
import { ensureGlobalExcerptSchema } from './memory-store/global-excerpt-store.js';
import { ensureWorldbookSchema } from './worldbook-schema.js';
import { ensureLibrarySchema } from './tidal-library.js';
import { ensureDailySchema } from './daily-schema.js';
import { ensureTreasureSchema } from './coast-vault-treasures.js';
import { ensureMediaLabelSchema } from './coast-vault-media-labels.js';
import { ensureStickerLibrarySchema } from './sticker-library.js';
import { ensureChatAttachmentSchema } from './chat-attachments.js';
import { ARCHIVE_CHUNK_BYTES,digestBytes,describeObject } from './coast-archive-v2-chunks.js';

const owned="SELECT id FROM conversations WHERE user_id='owner' AND deleted_at IS NULL AND conversation_kind='chat'";
const scope="conversation_id IN ("+owned+")";
const portraitColumns='id,body,write_enabled,revision,created_at,updated_at';
const candidates='id,proposed_body,change_kind,reason,source_conversation_id,source_message_id,source_model,created_at';
const revisions='id,revision,before_body,after_body,source_conversation_id,source_message_id,model_reason,confirmation_mode,operator,created_at';
const soilColumns='conversation_id,current_text,hand_seeds_json,do_not_repeat,pocket_candidates_json,afterthoughts_json,memory_candidates_json,seed_candidates_json,user_portrait_candidate_json,self_portrait_candidate_json,manual_locked,auto_refresh_enabled,organized_through_turn_id,source_assistant_id,tool_call_ids_json,revision,created_at,updated_at,actor,surface,model_label,model_nickname,symbol,display_author,source_conversation_id,source_turn_id,tool_call_id';
const dailyColumns='id,date,author,source,text,conversation_id,source_turn_id,tool_call_id,actor,surface,model_label,model_nickname,symbol,display_author,created_at,updated_at';
const spec=(module,ensure,table,columns,where='1=1')=>({module,ensure,table,columns,where});
// Only fixed, audited owner tables. No auth, visitor, provider configuration or arbitrary SQL.
const tables={
  worldbook:spec('worldbook',ensureWorldbookSchema,'coast_worldbook_entries','id,title,content,keywords_json,use_regex,case_sensitive,constant_active,priority,scan_depth,inject_position,enabled,scope,visitor_safe,created_at,updated_at'),
  custom_instructions:spec('custom_instructions',ensureMemorySchema,'memory_custom_instructions','id,content,updated_at,updated_by,source'),
  thinking_soil:spec('thinking_soil',ensureMemorySchema,'conversation_soils',soilColumns,scope),
  thinking_soil_history:spec('thinking_soil_history',ensureMemorySchema,'conversation_soil_snapshots','conversation_id,turn_id,assistant_message_id,current_text,afterthoughts_json,revision,model_label,display_author,created_at',scope),
  user_portrait:spec('user_portrait',ensureUserPortraitSchema,'user_portrait',portraitColumns),
  user_portrait_candidates:spec('user_portrait',ensureUserPortraitSchema,'user_portrait_candidates',candidates),
  user_portrait_revisions:spec('user_portrait',ensureUserPortraitSchema,'user_portrait_revisions',revisions),
  self_portrait:spec('self_portrait',ensureGlobalExcerptSchema,'global_excerpt',portraitColumns),
  self_portrait_candidates:spec('self_portrait',ensureGlobalExcerptSchema,'global_excerpt_candidates',candidates),
  self_portrait_revisions:spec('self_portrait',ensureGlobalExcerptSchema,'global_excerpt_revisions',revisions),
  daily_moments:spec('daily',ensureDailySchema,'daily_moments',dailyColumns+',status,reason,published_at'),
  daily_diaries:spec('daily',ensureDailySchema,'daily_diaries',dailyColumns+',weather,mood,tags_json'),
  daily_comments:spec('daily',ensureDailySchema,'daily_moment_comments','id,moment_id,author,text,created_at,model_id,usage_json'),
  daily_likes:spec('daily',ensureDailySchema,'daily_moment_likes','moment_id,actor,created_at'),
  daily_profile:spec('daily',ensureDailySchema,'daily_profile','id,owner_avatar_dataurl,model_partner_avatar_dataurl,moment_cover_dataurl,model_partner_display_name,updated_at',"id='owner'"),
  library_books:spec('library',ensureLibrarySchema,'coast_library_books','id,title,format,created_at,updated_at',"import_state='ready'"),
  library_chapters:spec('library',ensureLibrarySchema,'coast_library_chapters','book_id,chapter_index,title,body',"book_id IN (SELECT id FROM coast_library_books WHERE import_state='ready')"),
  library_notes:spec('library',ensureLibrarySchema,'coast_library_notes','id,book_id,chapter_index,paragraph_index,quote,kind,body,author,source,conversation_id,source_turn_id,created_at,updated_at,start_offset,end_offset',"book_id IN (SELECT id FROM coast_library_books WHERE import_state='ready')"),
  library_progress:spec('library',ensureLibrarySchema,'coast_library_progress','book_id,author,chapter_index,paragraph_index,updated_at',"book_id IN (SELECT id FROM coast_library_books WHERE import_state='ready')"),
  library_reading_logs:spec('library',ensureLibrarySchema,'coast_library_reading_logs','book_id,author,day,chapter_index,paragraph_index,updated_at',"book_id IN (SELECT id FROM coast_library_books WHERE import_state='ready')"),
  library_covers:spec('library',ensureLibrarySchema,'coast_library_covers','book_id,mime,size,updated_at',"book_id IN (SELECT id FROM coast_library_books WHERE import_state='ready')"),
  vault_treasures:spec('vault',ensureTreasureSchema,'coast_vault_treasures','id,source_key,kind,conversation_id,turn_id,message_id,source_id,role,excerpt,selections_json,notes,created_at,updated_at',scope),
  vault_stickers:spec('vault',ensureStickerLibrarySchema,'coast_sticker_library','id,conversation_id,attachment_id,description,author,enabled,created_at,updated_at',scope),
  vault_media_labels:spec('vault',async db=>{await ensureChatAttachmentSchema(db);await ensureMediaLabelSchema(db);},'coast_vault_media_labels','source_key,display_name,updated_at',"source_key IN (SELECT 'image:'||conversation_id||':'||id FROM chat_attachments WHERE kind='image' AND "+scope+")")
};
export const DETAIL_MODULES=Object.freeze(Object.fromEntries(Object.entries(tables).map(([name,s])=>[name,s.module])));
const check=(ok,msg)=>{if(!ok)throw Object.assign(Error(msg),{status:400});};
export async function archiveDetailPage(db,kind,{cursor='',limit=20}={}){
  check(Object.hasOwn(tables,kind),'unsupported archive detail');
  check(cursor===''||/^[0-9]{1,15}$/.test(cursor),'invalid archive detail cursor');
  check(Number.isInteger(limit)&&limit>=1&&limit<=50,'invalid archive detail page size');
  const t=tables[kind];await t.ensure(db);
  // rowid is a paging cursor only. Preserve the real (possibly composite) record key.
  const rows=(await db.prepare('SELECT rowid AS archive_cursor,'+t.columns+' FROM '+t.table+' WHERE ('+t.where+') AND rowid>? ORDER BY rowid LIMIT ?').bind(Number(cursor||0),limit+1).all()).results||[];
  const items=rows.slice(0,limit);
  return {module:t.module,kind,items:items.map(({archive_cursor,...record})=>record),next_cursor:rows.length>limit?String(items.at(-1).archive_cursor):null};
}
export async function readArchiveLibraryCover(db,id){
  check(typeof id==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(id),'invalid library book id');
  await ensureLibrarySchema(db);
  const row=await db.prepare('SELECT c.book_id,c.mime,c.size,c.updated_at,c.data FROM coast_library_covers c JOIN coast_library_books b ON b.id=c.book_id WHERE c.book_id=? AND b.import_state=\'ready\'').bind(id).first();
  if(!row)throw Object.assign(Error('library cover missing'),{status:404});
  const {data,...metadata}=row;
  const bytes=data instanceof ArrayBuffer?new Uint8Array(data):ArrayBuffer.isView(data)?new Uint8Array(data.buffer,data.byteOffset,data.byteLength):Uint8Array.from(data||[]);
  check(bytes.length===metadata.size&&bytes.length>0,'library cover incomplete');
  const chunks=[];for(let i=0;i<bytes.length;i+=ARCHIVE_CHUNK_BYTES)chunks.push(bytes.subarray(i,i+ARCHIVE_CHUNK_BYTES));
  return {metadata,descriptor:await describeObject(bytes.length,await Promise.all(chunks.map(digestBytes))),chunks};
}

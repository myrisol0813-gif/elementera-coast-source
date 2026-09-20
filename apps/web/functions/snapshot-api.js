import { apiError, json, methodNotAllowed, unexpectedApiError } from './http.js';
import { requireOwnerSession, OwnerAccessError } from './owner-access.js';
import { listConversations, readConversationState, readOwnerProfile } from './chat-store.js';
import { getHumanThought } from './human-thought-store.js';
import {
  listEntries, listPockets, readSoil, readCustomInstructions, readGlobalExcerpt,
} from './memory-store.js';
import { listWorldbookEntries } from './worldbook.js';
import { listToolRuns } from './tool-run-log.js';
import { listExternalMessages } from './external-entry-store.js';
import { integrationCatalog } from './source-integrations.js';

const V1='/api/export/v1-snapshot';
const FULL='/api/export/full-archive';
export function isSnapshotApiPath(pathname){return pathname===V1||pathname===FULL;}

async function allEntries(db){
  const result=[]; let cursor='0';
  for(let page=0;page<50;page+=1){
    const batch=await listEntries(db,{limit:100,cursor});
    result.push(...(batch.entries||[]));
    if(!batch.next_cursor)break;
    cursor=batch.next_cursor;
  }
  return result;
}
async function safePockets(db,conversationId){
  try{return await listPockets(db,{conversation_id:conversationId,status:'pending'});}catch{return [];}
}
async function conversationBundle(db,conversation){
  const [history,humanThought,soil,pockets]=await Promise.all([
    readConversationState(db,conversation.id),
    getHumanThought(db,{conversation_id:conversation.id}),
    readSoil(db,conversation.id),
    safePockets(db,conversation.id),
  ]);
  return {conversation,history,human_thought:humanThought,current_conversation_paper:soil,pending_area:pockets};
}
async function buildSnapshot(db,{kind='v1_snapshot'}={}){
  const conversations=await listConversations(db);
  const [profile,memoryEntries,customInstructions,globalExcerpt,worldbook,toolRuns,externalMessages]=await Promise.all([
    readOwnerProfile(db),
    allEntries(db),
    readCustomInstructions(db),
    readGlobalExcerpt(db),
    listWorldbookEntries(db,{include_disabled:true}),
    listToolRuns(db,{limit:100}),
    listExternalMessages(db,{limit:200}),
  ]);
  const conversationData=[];
  for(const conversation of conversations)conversationData.push(await conversationBundle(db,conversation));
  return {
    format:'elementera-coast-source-snapshot',
    version:1,
    kind,
    exported_at:new Date().toISOString(),
    source_only:true,
    notes:[
      'This export contains only data stored by this source deployment.',
      'No secrets, access tokens, cookies, authorization headers, remote credentials, or private service configuration are included.',
      'Attachment information remains metadata inside chat history; file bytes are not embedded by this source skeleton.',
      'Tool call records are exported as redacted summaries.',
    ],
    owner_profile:profile,
    conversations:conversationData,
    memory_entries:memoryEntries,
    custom_instructions:customInstructions,
    global_excerpt:globalExcerpt,
    worldbook,
    external_entry_messages:externalMessages,
    tool_run_summaries:toolRuns,
    integration_contracts:integrationCatalog(),
  };
}
export async function routeSnapshotApi(request,env,session=null){
  const url=new URL(request.url);
  try{
    requireOwnerSession(session);
    if(request.method!=='GET')return methodNotAllowed('GET');
    if(!env?.COAST_CHAT_DB?.prepare)return apiError('chat_db_not_configured','Chat database is not configured.',503);
    const kind=url.pathname===FULL?'full_archive':'v1_snapshot';
    const payload=await buildSnapshot(env.COAST_CHAT_DB,{kind});
    const filename=`elementera-coast-source-${kind}.json`;
    return json(payload,200,{'Content-Disposition':`attachment; filename="${filename}"`});
  }catch(error){
    if(error instanceof OwnerAccessError)return apiError(error.type,error.message,error.status);
    return unexpectedApiError('snapshot-api',error,'snapshot_failed','快照导出失败。');
  }
}

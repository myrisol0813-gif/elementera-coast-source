import { listConversations, readConversationState, sanitizeId } from './chat-store.js';

export const CROSS_WINDOW_DESCRIPTION = '这里列出当前 source 部署中的其他聊天窗口。屋主可以手动读取少量近期内容，用来回想别处发生过的对话；系统不会自动把这些内容递给模型。';
export const CROSS_WINDOW_LIMITS = Object.freeze({ default_turns:4, technical_max_turns_per_source:200 });

function activeVariant(list,active){
  const values=Array.isArray(list)?list:[];
  if(!values.length)return null;
  const index=Math.min(Math.max(0,Number(active)||0),values.length-1);
  const value=values[index]||null;
  if(!value||value.hidden===true||typeof value.content!=='string'||!value.content.trim())return null;
  return value;
}

function activeTurns(state){
  const out=[];
  for(const turn of Array.isArray(state?.turns)?state.turns:[]){
    const owners=turn?.owner?.variants||[];
    const ownerIndex=Math.min(Math.max(0,Number(turn?.owner?.active)||0),Math.max(0,owners.length-1));
    const owner=activeVariant(owners,ownerIndex);
    if(!owner)continue;
    const partners=turn?.model_partner?.variantsByOwnerVariant?.[String(ownerIndex)]||[];
    const modelPartner=activeVariant(partners,turn?.model_partner?.activeByOwnerVariant?.[String(ownerIndex)]);
    const messages=[{
      role:'owner',
      message_id:owner.id||`${turn.id||'turn'}:owner`,
      content:owner.content,
      created_at:owner.created_at||null,
      ...(owner.display_author?{display_author:String(owner.display_author).slice(0,180)}:{}),
    }];
    if(modelPartner)messages.push({
      role:'model_partner',
      message_id:modelPartner.id||`${turn.id||'turn'}:model_partner`,
      content:modelPartner.content,
      created_at:modelPartner.created_at||null,
      ...(modelPartner.model_id?{model_id:String(modelPartner.model_id).slice(0,180)}:{}),
    });
    out.push({turn_id:turn.id||null,messages});
  }
  return out;
}

function sourceKind(conversation){
  if(conversation?.room_type==='radio')return 'api_common_room';
  if(conversation?.room_type==='lighthouse')return 'official_mcp';
  return 'source_chat';
}

function previewText(value,max=180){
  const text=String(value||'').replace(/\s+/gu,' ').trim();
  return text.length>max?`${text.slice(0,max)}…`:text;
}

function requestError(type,message,status=400){
  const error=new Error(message);error.type=type;error.status=status;return error;
}

function normalizedTurns(value){
  const number=Number(value);
  if(!Number.isFinite(number)||number<1)return CROSS_WINDOW_LIMITS.default_turns;
  const turns=Math.floor(number);
  if(turns>CROSS_WINDOW_LIMITS.technical_max_turns_per_source)throw requestError('cross_window_technical_limit',`单窗口请求超过技术保护上限 ${CROSS_WINDOW_LIMITS.technical_max_turns_per_source} 轮。`);
  return turns;
}

async function sourceRecord(db,conversation,currentConversationId=''){
  let turns=[];
  try{turns=activeTurns(await readConversationState(db,conversation.id));}catch{turns=[];}
  const current=conversation.id===currentConversationId;
  return {
    conversation_id:conversation.id,
    title:conversation.title,
    room_type:conversation.room_type,
    source:sourceKind(conversation),
    updated_at:conversation.updated_at,
    message_count:turns.reduce((sum,turn)=>sum+turn.messages.length,0),
    turn_count:turns.length,
    readable:!current&&turns.length>0,
    disabled_reason:current?'当前窗口无需跨窗口读取':turns.length?'':'暂无可读取对话',
    _turns:turns,
  };
}

export async function listCrossWindowSources(db,{currentConversationId=''}={}){
  const current=currentConversationId?sanitizeId(currentConversationId,'conversation'):'';
  const conversations=await listConversations(db);
  const records=[];
  for(const conversation of conversations)records.push(await sourceRecord(db,conversation,current));
  return {description:CROSS_WINDOW_DESCRIPTION,limits:{...CROSS_WINDOW_LIMITS},sources:records.map(({_turns,...record})=>record)};
}

export async function listCrossWindowMessageIndex(db,{currentConversationId=''}={}){
  const current=currentConversationId?sanitizeId(currentConversationId,'conversation'):'';
  const conversations=await listConversations(db);
  const sources=[];
  for(const conversation of conversations){
    const record=await sourceRecord(db,conversation,current);
    const {_turns,...publicRecord}=record;
    sources.push({
      ...publicRecord,
      turns:_turns.map((turn,index)=>({
        turn_id:turn.turn_id,
        turn_number:index+1,
        messages:turn.messages.map((message)=>({
          message_id:message.message_id,
          role:message.role,
          created_at:message.created_at||null,
          model_id:message.model_id||null,
          display_author:message.display_author||null,
          preview:previewText(message.content),
          length:String(message.content||'').length,
        })),
      })),
    });
  }
  return {description:CROSS_WINDOW_DESCRIPTION,limits:{...CROSS_WINDOW_LIMITS},sources};
}

export async function readCrossWindow(db,value={}){
  const current=value.current_conversation_id?sanitizeId(value.current_conversation_id,'conversation'):'';
  const conversations=await listConversations(db);
  const byId=new Map(conversations.map((conversation)=>[conversation.id,conversation]));
  const items=[];
  const requested=Array.isArray(value.sources)?value.sources.slice(0,20):[];

  for(const source of requested){
    const id=sanitizeId(source?.conversation_id||'','conversation');
    if(id===current||!byId.has(id))continue;
    const record=await sourceRecord(db,byId.get(id),current);
    if(!record.readable)continue;
    const turns=normalizedTurns(source?.turns);
    const chosen=record._turns.slice(-turns);
    const messages=chosen.flatMap((turn)=>turn.messages.map((message)=>({...message,turn_id:turn.turn_id})));
    const {_turns,readable,disabled_reason,message_count,turn_count,...publicRecord}=record;
    items.push({...publicRecord,requested_turns:turns,loaded_turns:chosen.length,loaded_chars:messages.reduce((sum,message)=>sum+message.content.length,0),messages});
  }

  return {
    mode:'manual',
    description:CROSS_WINDOW_DESCRIPTION,
    limits:{...CROSS_WINDOW_LIMITS},
    items,
    requested_windows:requested.length,
    loaded_windows:items.length,
    total_loaded_turns:items.reduce((sum,item)=>sum+item.loaded_turns,0),
    total_loaded_chars:items.reduce((sum,item)=>sum+item.loaded_chars,0),
    delivered_to_model:false,
  };
}

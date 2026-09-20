import { createConversation, listConversations, readConversationState, writeConversationState } from './chat-store.js';

const ROOM_BY_CHANNEL=Object.freeze({
  api_common_room:{room_type:'radio',title:'官端 MCP 与 API 共通聊天室',message_source:'external'},
  official_mcp:{room_type:'lighthouse',title:'与官端 MCP 对话区',message_source:'official_mcp'},
});
function clean(value,max){return String(value??'').trim().slice(0,max);}
async function targetConversation(db,channel){
  const config=ROOM_BY_CHANNEL[channel];
  if(!config)return null;
  const conversations=await listConversations(db);
  return conversations.find((item)=>item.room_type===config.room_type)
    || createConversation(db,{title:config.title,room_type:config.room_type});
}
export async function deliverExternalToRoom(db,value={}){
  const channel=String(value.channel||'');
  const config=ROOM_BY_CHANNEL[channel];
  if(!config)return null;
  const content=clean(value.content,12000);
  if(!content)return null;
  const conversation=await targetConversation(db,channel);
  const history=await readConversationState(db,conversation.id);
  const state=history&&typeof history==='object'?history:{version:4,turns:[]};
  const turns=Array.isArray(state.turns)?state.turns:[];
  const now=new Date().toISOString();
  const turnId=`turn_${crypto.randomUUID()}`;
  const ownerId=`owner_${crypto.randomUUID()}`;
  turns.push({
    id:turnId,
    owner:{active:0,variants:[{
      id:ownerId,
      content,
      created_at:now,
      message_source:config.message_source,
      display_author:clean(value.author,120)||CHANNEL_BY_AUTHOR[channel],
    }]},
    model_partner:{activeByOwnerVariant:{0:0},variantsByOwnerVariant:{0:[]}},
  });
  state.version=4;
  state.updated_at=now;
  state.turns=turns.slice(-400);
  await writeConversationState(db,conversation.id,state);
  return {conversation_id:conversation.id,room_type:config.room_type,turn_id:turnId};
}
const CHANNEL_BY_AUTHOR=Object.freeze({
  api_common_room:'API / MCP',
  official_mcp:'Official MCP',
});

import { apiError, isRequestBodyError, json, methodNotAllowed, readJson, requestBodyError, unexpectedApiError } from './http.js';
import { OwnerAccessError, requireOwnerSession } from './owner-access.js';
import { appendExternalMessage, listExternalMessages } from './external-entry-store.js';
import { deliverExternalToRoom } from './room-bridge-service.js';

const ROOT='/api/external/messages';
const STATUS='/api/external/status';
export function isExternalEntryApiPath(pathname){return pathname===ROOT||pathname===STATUS;}
export async function routeExternalEntryApi(request,env,session=null){
  const url=new URL(request.url);
  try{
    requireOwnerSession(session);
    if(!env?.COAST_CHAT_DB?.prepare)return apiError('chat_db_not_configured','Chat database is not configured.',503);
    if(url.pathname===STATUS){
      if(request.method!=='GET')return methodNotAllowed('GET');
      return json({ok:true,mode:'source',ingress:'owner_session_only',channels:[
        {id:'external',label:'外部入口消息'},
        {id:'api_common_room',label:'官端 MCP 与 API 共通聊天室'},
        {id:'official_mcp',label:'与官端 MCP 对话区'},
      ],note:'Source mode does not include production authentication or remote delivery configuration.'});
    }
    if(url.pathname===ROOT){
      if(request.method==='GET')return json({ok:true,messages:await listExternalMessages(env.COAST_CHAT_DB,{channel:url.searchParams.get('channel')||'',limit:url.searchParams.get('limit')||100})});
      if(request.method==='POST'){
        const value=await readJson(request);
        const message=await appendExternalMessage(env.COAST_CHAT_DB,value);
        const delivery=value.deliver_to_room===false?null:await deliverExternalToRoom(env.COAST_CHAT_DB,value);
        return json({ok:true,message,delivery},201);
      }
      return methodNotAllowed('GET, POST');
    }
    return apiError('not_found','Not found.',404);
  }catch(error){
    if(error instanceof OwnerAccessError||error?.type)return apiError(error.type||'external_entry_failed',error.message||'外部入口操作失败。',error.status||400);
    if(isRequestBodyError(error)){const mapped=requestBodyError(error);return apiError(mapped.type,mapped.message,mapped.status);}
    return unexpectedApiError('external-entry-api',error,'external_entry_failed','外部入口操作失败。');
  }
}

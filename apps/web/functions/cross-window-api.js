import { apiError, isRequestBodyError, json, methodNotAllowed, readJson, requestBodyError, unexpectedApiError } from './http.js';
import { OwnerAccessError, requireOwnerSession } from './owner-access.js';
import { listCrossWindowMessageIndex, listCrossWindowSources, readCrossWindow } from './cross-window-service.js';

const SOURCES='/api/chat/cross-window/sources';
const MESSAGES='/api/chat/cross-window/messages';
const READ='/api/chat/cross-window/read';

export function isCrossWindowApiPath(pathname){return pathname===SOURCES||pathname===MESSAGES||pathname===READ;}

export async function routeCrossWindowApi(request,env,session=null){
  const url=new URL(request.url);
  try{
    requireOwnerSession(session);
    if(!env?.COAST_CHAT_DB?.prepare)return apiError('chat_db_not_configured','Chat database is not configured.',503);
    if(url.pathname===SOURCES){
      if(request.method!=='GET')return methodNotAllowed('GET');
      return json({ok:true,...await listCrossWindowSources(env.COAST_CHAT_DB,{currentConversationId:url.searchParams.get('current_conversation_id')||''})});
    }
    if(url.pathname===MESSAGES){
      if(request.method!=='GET')return methodNotAllowed('GET');
      return json({ok:true,...await listCrossWindowMessageIndex(env.COAST_CHAT_DB,{currentConversationId:url.searchParams.get('current_conversation_id')||''})});
    }
    if(url.pathname===READ){
      if(request.method!=='POST')return methodNotAllowed('POST');
      return json({ok:true,...await readCrossWindow(env.COAST_CHAT_DB,await readJson(request))});
    }
    return apiError('not_found','Not found.',404);
  }catch(error){
    if(error instanceof OwnerAccessError||error?.type)return apiError(error.type||'cross_window_failed',error.message||'跨窗口读取失败。',error.status||400);
    if(isRequestBodyError(error)){const mapped=requestBodyError(error);return apiError(mapped.type,mapped.message,mapped.status);}
    return unexpectedApiError('cross-window-api',error,'cross_window_failed','跨窗口读取失败。');
  }
}

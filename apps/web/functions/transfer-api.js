import { apiError, json, methodNotAllowed, readJson, unexpectedApiError } from './http.js';
import { TransferError, TRANSFER_CLOUD_LIMIT } from './transfer-codec.js';
import { exportTransferChat, previewTransferChat, importTransferChat } from './transfer-chat-store.js';
const BASE = '/api/transfer/chat';
export function isTransferApiPath(path) { return [BASE, BASE+'/preview', BASE+'/import'].includes(path); }
export async function routeTransferApi(request, env) {
  const url = new URL(request.url);
  const db = env.COAST_CHAT_DB;
  try {
    if (url.pathname === BASE) {
      if (request.method !== 'GET') return methodNotAllowed('GET');
      return json({ok:true,bundle:await exportTransferChat(db,url.searchParams.getAll('conversation_id'))});
    }
    if (request.method !== 'POST') return methodNotAllowed('POST');
    const value = await readJson(request,TRANSFER_CLOUD_LIMIT);
    if (url.pathname.endsWith('/preview')) return json({ok:true,preview:await previewTransferChat(db,value.bundle)});
    return json({ok:true,result:await importTransferChat(db,value.bundle,{confirm:value.confirm,acceptOmissions:value.accept_omissions})});
  } catch (error) {
    if (error instanceof TransferError) return apiError(error.type,error.message,error.status);
    if (error?.message === 'body_too_large') return apiError('transfer_too_large','云端单次导入最多 8 MiB。',413);
    if (error?.message === 'invalid_json') return apiError('invalid_json','数据包不是有效 JSON。',400);
    return unexpectedApiError('transfer',error,'transfer_failed','迁移失败，未确认写入。');
  }
}

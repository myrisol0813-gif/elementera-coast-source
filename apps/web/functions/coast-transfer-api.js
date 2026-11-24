import { apiError,json,readJson,methodNotAllowed,isRequestBodyError,unexpectedApiError } from './http.js';
import { CLOUD_IMPORT_LIMIT, TransferError } from './coast-transfer.js';
import { exportCloudTransfer, previewCloudTransfer, importCloudTransfer } from './coast-transfer-store.js';

const BASE='/api/transfer/v1';
export const isTransferApiPath=path=>[BASE,BASE+'/preview',BASE+'/import'].includes(path);
export async function routeTransferApi(request,env,session) {
  if (!session) return apiError('unauthorized','请先登录海岸。',401);
  const path=new URL(request.url).pathname;
  const db=env.COAST_CHAT_DB;
  if (!db) return apiError('database_unavailable','目标数据库不可用。',503);
  try {
    if (path===BASE) {
      if (request.method!=='GET') return methodNotAllowed('GET');
      return json({ok:true,bundle:await exportCloudTransfer(db)});
    }
    if (request.method!=='POST') return methodNotAllowed('POST');
    const body=await readJson(request,CLOUD_IMPORT_LIMIT+4096);
    if (path===BASE+'/preview') return json({ok:true,preview:await previewCloudTransfer(db,body.bundle,body.modules)});
    if (body.confirm!==true) return apiError('confirmation_required','请确认将选定资料写入当前云端。',400);
    return json({ok:true,result:await importCloudTransfer(db,body.bundle,body.modules)});
  } catch(e) {
    if (e instanceof TransferError) return apiError(e.type,e.message,e.status);
    if (isRequestBodyError(e)) return apiError(e.message,'导入请求格式无效或超过 8 MiB。',e.status||400);
    return unexpectedApiError('transfer',e,'transfer_failed','数据包操作失败，未确认导入成功');
  }
}

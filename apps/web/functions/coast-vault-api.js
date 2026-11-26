import {
  apiError, json, methodNotAllowed, readJson, requestBodyError, unexpectedApiError,
} from './http.js';
import { listMediaLibrary, MediaLibraryError } from './coast-vault-media.js';
import { renameVaultImage, MediaLabelError } from './coast-vault-media-labels.js';
import { inspectLegacyHearts } from './coast-vault-legacy.js';
import {
  TreasureError, listTreasures, saveTreasure, updateTreasure, removeTreasure,
} from './coast-vault-treasures.js';

import {StickerError,registerSticker,listOwnerStickers,updateOwnerSticker,removeOwnerSticker} from './sticker-library.js';
const BASE = '/api/coast-vault';
export function isCoastVaultApiPath(path) {
  return path === BASE || path.startsWith(BASE + '/');
}

async function route(request, env) {
  if (!env?.COAST_CHAT_DB?.prepare) return apiError('database_unavailable', '海岸文件库暂时无法访问。', 503);
  const url = new URL(request.url);
  const path = url.pathname.slice(BASE.length);
  const params = url.searchParams;
  if(path==='/stickers'){
    if(request.method==='GET')return json({ok:true,...await listOwnerStickers(env.COAST_CHAT_DB,{q:params.get('q')||'',cursor:Number(params.get('cursor')||0)},{actor:'owner'})});
    if(request.method==='POST')return json({ok:true,item:await registerSticker(env.COAST_CHAT_DB,await readJson(request,4000),{actor:'owner'})},201);
    return methodNotAllowed('GET, POST');
  }
  const sticker=/^\/stickers\/([a-zA-Z0-9_.:-]+)$/.exec(path);
  if(sticker){
    if(request.method==='PATCH')return json({ok:true,item:await updateOwnerSticker(env.COAST_CHAT_DB,sticker[1],await readJson(request,4000),{actor:'owner'})});
    if(request.method==='DELETE')return json({ok:true,...await removeOwnerSticker(env.COAST_CHAT_DB,sticker[1],{actor:'owner'})});
    return methodNotAllowed('PATCH, DELETE');
  }
  if (path === '/media') {
    if (request.method !== 'GET') return methodNotAllowed('GET');
    return json({ ok: true, ...(await listMediaLibrary(env.COAST_CHAT_DB, {
      kind: params.get('kind'), q: params.get('q'), cursor: params.get('cursor') || 0,
    })) });
  }
  if (path === '/media-labels') {
    if (request.method !== 'PATCH') return methodNotAllowed('PATCH');
    return json({ ok: true, item: await renameVaultImage(
      env.COAST_CHAT_DB, await readJson(request, 2000),
    ) });
  }
  if (path === '/legacy-hearts') {
    if (request.method === 'GET') return json({
      ok: true, ...(await inspectLegacyHearts(env.COAST_CHAT_DB, {
        cursor: params.get('cursor') || 0, apply: false,
      })),
    });
    if (request.method === 'POST') {
      const input = await readJson(request, 2000);
      if (input.confirm !== true) return apiError(
        'confirmation_required', '迁移旧收藏前需要明确确认。', 409
      );
      return json({
        ok: true, ...(await inspectLegacyHearts(env.COAST_CHAT_DB, {
          cursor: input.cursor || 0, apply: true,
        })),
      });
    }
    return methodNotAllowed('GET, POST');
  }
  if (path === '/treasures') {
    if (request.method === 'GET') return json({ ok: true, ...(await listTreasures(env.COAST_CHAT_DB, {
      kind: params.get('kind'), q: params.get('q'), cursor: params.get('cursor') || 0,
      conversation_id: params.get('conversation_id') || '', turn_id: params.get('turn_id') || '',
    })) });
    if (request.method === 'POST') return json({
      ok: true, item: await saveTreasure(env.COAST_CHAT_DB, await readJson(request, 16000)),
    }, 201);
    return methodNotAllowed('GET, POST');
  }
  const match = /^\/treasures\/([a-zA-Z0-9_:.-]+)$/.exec(path);
  if (match) {
    if (request.method === 'PATCH') return json({
      ok: true, item: await updateTreasure(env.COAST_CHAT_DB, match[1], await readJson(request, 4000)),
    });
    if (request.method === 'DELETE') return json({
      ok: true, ...(await removeTreasure(env.COAST_CHAT_DB, match[1])),
    });
    return methodNotAllowed('PATCH, DELETE');
  }
  return apiError('not_found', '文件库入口不存在。', 404);
}

export async function routeCoastVaultApi(request, env) {
  try { return await route(request, env); }
  catch (error) {
    if (error instanceof StickerError || error instanceof MediaLibraryError || error instanceof MediaLabelError || error instanceof TreasureError) {
      return apiError(error.type, error.message, error.status);
    }
    if (['invalid_json', 'body_too_large'].includes(error?.message)) {
      const failure = requestBodyError(error);
      return apiError(failure.type, failure.message, failure.status);
    }
    return unexpectedApiError('coast-vault-api', error, 'vault_failure', '海岸文件库操作失败');
  }
}

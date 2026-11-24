import { apiError, json, readJson, securityHeaders, unexpectedApiError } from './http.js';
import { listArchiveAttachments, readArchiveAttachment, listArchiveDogtalk } from './coast-archive-v2-media.js';
import { STAGING_LIMITS, createArchiveSession, listArchiveSessions, cancelArchiveSession, registerArchiveObject, putArchiveChunk, archiveObjectStatus, preflightArchiveSession } from './coast-archive-v2-stage.js';

import { archiveRecordPage, readArchiveChat, readArchiveVoice, RECORD_MODULES } from './coast-archive-v2-records.js';
import { validateArchiveManifest, MODULES } from './coast-archive-v2-manifest.js';

import { archiveDetailPage, readArchiveLibraryCover, DETAIL_MODULES } from './coast-archive-v2-details.js';

import { restoreArchiveChatGroup } from './coast-archive-v2-restore.js';
import { restoreArchiveBook } from './coast-archive-v2-restore-library.js';
import { restoreArchiveRecord } from './coast-archive-v2-restore-record.js';
const BASE='/api/archive/v2';
export const isArchiveV2Path=path=>path===BASE||path.startsWith(BASE+'/');
async function binaryBody(request){
  const reader=request.body?.getReader();const parts=[];let size=0;
  if(!reader)throw Object.assign(Error('missing chunk'),{status:400});
  try{
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>STAGING_LIMITS.chunkBytes){await reader.cancel();throw Object.assign(Error('chunk exceeds 1 MiB'),{status:413});}parts.push(value);}
  }finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let pos=0;for(const p of parts){bytes.set(p,pos);pos+=p.length;}return bytes;
}
export async function routeArchiveV2(request,env,session){
  if(!session)return apiError('unauthorized','请先登录海岸。',401);
  const db=env.COAST_CHAT_DB;
  if(!db)return apiError('database_unavailable','海岸数据库不可用。',503);
  const url=new URL(request.url),parts=url.pathname.slice(BASE.length).split('/').filter(Boolean),method=request.method;
  try{
    if(method==='GET'&&parts.length===0)return json({ok:true,limits:STAGING_LIMITS,record_modules:RECORD_MODULES,manifest_modules:MODULES,detail_modules:DETAIL_MODULES,chat_group_restore_supported:true,book_restore_supported:true,record_restore_modules:['calendar','worldbook','model_profile','memory_entries','memory_pockets','user_portrait','self_portrait','daily','vault','custom_instructions','thinking_soil','thinking_soil_history','tools'],local_record_restore_modules:['chat','calendar','daily','model_profile','worldbook','custom_instructions','memory_entries','memory_pockets','user_portrait','self_portrait','thinking_soil','thinking_soil_history','tools','vault'],restore_supported:false,stage_only:true});
    const opts={cursor:url.searchParams.get('cursor')||'',limit:Number(url.searchParams.get('limit')||50)};
    if(method==='POST'&&parts.join('/')==='manifest/validate')return json({ok:true,...await validateArchiveManifest(await readJson(request,2*1024*1024)),restore_supported:false});
    if(method==='GET'&&parts[0]==='details'&&parts.length===2)return json({ok:true,...await archiveDetailPage(db,parts[1],opts)});
    if(method==='GET'&&parts[0]==='library-cover'&&(parts.length===2||parts.length===4&&parts[2]==='chunks')){
      const item=await readArchiveLibraryCover(db,parts[1]);
      if(parts.length===2)return json({ok:true,metadata:item.metadata,descriptor:item.descriptor});
      const index=Number(parts[3]);
      if(!/^(0|[1-9]\d*)$/.test(parts[3])||!item.chunks[index])return apiError('invalid_chunk','封面分块不存在。',404);
      if(url.searchParams.get('object_sha256')!==item.descriptor.object_sha256)return apiError('source_changed','封面原件已变化。',409);
      return new Response(item.chunks[index],{headers:securityHeaders({'Content-Type':'application/octet-stream','X-Coast-Chunk-SHA256':item.descriptor.chunks[index]})});
    }
    if(method==='GET'&&parts[0]==='records'&&parts.length===2)return json({ok:true,...await archiveRecordPage(db,parts[1],opts)});
    if(method==='GET'&&parts[0]==='records'&&parts[1]==='chat'&&parts.length===3)return json({ok:true,...await readArchiveChat(db,parts[2])});
    if(method==='GET'&&parts[0]==='voice'&&(parts.length===2||parts.length===4&&parts[2]==='chunks')){
      const item=await readArchiveVoice(db,parts[1]);
      if(parts.length===2)return json({ok:true,metadata:item.metadata,descriptor:item.descriptor});
      const index=Number(parts[3]);
      if(!/^(0|[1-9]\d*)$/.test(parts[3])||!item.chunks[index])return apiError('invalid_chunk','语音分块不存在。',404);
      if(url.searchParams.get('object_sha256')!==item.descriptor.object_sha256)return apiError('source_changed','语音原件已变化。',409);
      return new Response(item.chunks[index],{headers:securityHeaders({'Content-Type':'application/octet-stream','X-Coast-Chunk-SHA256':item.descriptor.chunks[index]})});
    }
    if(method==='GET'&&parts.join('/')==='inventory/attachments')return json({ok:true,...await listArchiveAttachments(db,opts)});
    if(method==='GET'&&parts.join('/')==='inventory/dogtalk')return json({ok:true,...await listArchiveDogtalk(db,{...opts,kind:url.searchParams.get('kind')||'snapshots'})});
    if(method==='GET'&&parts[0]==='attachments'&&(parts.length===3||parts.length===5&&parts[3]==='chunks')){
      const item=await readArchiveAttachment(db,parts[1],parts[2]);
      if(parts.length===3)return json({ok:true,metadata:item.metadata,descriptor:item.descriptor});
      const index=Number(parts[4]);
      if(!/^(0|[1-9]\d*)$/.test(parts[4])||!Number.isInteger(index)||!item.chunks[index])return apiError('invalid_chunk','原件分块不存在。',404);
      if(url.searchParams.get('object_sha256')!==item.descriptor.object_sha256)return apiError('source_changed','原件已变化，请重新读取清单。',409);
      return new Response(item.chunks[index],{headers:securityHeaders({'Content-Type':'application/octet-stream','X-Coast-Chunk-SHA256':item.descriptor.chunks[index]})});
    }
    if(parts[0]==='sessions'){
      if(parts.length===1&&method==='GET')return json({ok:true,sessions:await listArchiveSessions(db)});
      if(parts.length===1&&method==='POST')return json({ok:true,session:await createArchiveSession(db)},201);
      if(parts.length===2&&method==='DELETE')return json({ok:true,...await cancelArchiveSession(db,parts[1])});
      if(parts.length===5&&parts[2]==='record-restore'&&method==='POST'){
        const body=await readJson(request,2*1024*1024);
        if(!body||typeof body.confirm!=='boolean')return apiError('invalid_restore','必须明确指定预览或确认恢复。',400);
        return json({ok:true,...await restoreArchiveRecord(db,parts[1],body.manifest,parts[3],parts[4],body.confirm)});
      }
      if(parts.length===4&&parts[2]==='book-restore'&&method==='POST'){
        const body=await readJson(request,2*1024*1024);
        if(!body||typeof body.confirm!=='boolean')return apiError('invalid_restore','必须明确指定预览或确认恢复。',400);
        return json({ok:true,...await restoreArchiveBook(db,parts[1],body.manifest,parts[3],body.confirm)});
      }
      if(parts.length===4&&parts[2]==='chat-restore'&&method==='POST'){
        const body=await readJson(request,2*1024*1024);
        if(!body||typeof body.confirm!=='boolean')return apiError('invalid_restore','必须明确指定预览或确认恢复。',400);
        return json({ok:true,...await restoreArchiveChatGroup(db,parts[1],body.manifest,parts[3],body.confirm)});
      }
      if(parts.length===3&&parts[2]==='preflight'&&method==='POST')return json({ok:true,...await preflightArchiveSession(db,parts[1],await readJson(request,2*1024*1024))});
      if(parts.length===3&&parts[2]==='objects'&&method==='POST')return json({ok:true,...await registerArchiveObject(db,parts[1],await readJson(request,256*1024))});
      if(parts.length===4&&parts[2]==='objects'&&method==='GET')return json({ok:true,...await archiveObjectStatus(db,parts[1],parts[3])});
      if(parts.length===6&&parts[2]==='objects'&&parts[4]==='chunks'&&method==='PUT'&&/^(0|[1-9]\d*)$/.test(parts[5]))return json({ok:true,...await putArchiveChunk(db,parts[1],parts[3],Number(parts[5]),await binaryBody(request))});
    }
    return apiError('not_found','归档接口不存在。',404);
  }catch(e){
    const status=Number(e?.status);
    if([400,404,409,410,413].includes(status))return apiError('archive_request_failed','归档请求未完成。'+String(e.message).slice(0,120),status);
    if(e?.message==='invalid_json'||e?.message==='body_too_large')return apiError('archive_request_failed','归档请求格式或长度无效。',e.message==='body_too_large'?413:400);
    // Validation failures without a status are not published, and internal errors
    // must not leak database contents to the client.
    return unexpectedApiError('archive_v2',e,'archive_failed','归档操作失败；现有资料未恢复或覆盖');
  }
}

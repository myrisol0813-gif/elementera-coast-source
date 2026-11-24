import test from 'node:test';
import assert from 'node:assert/strict';
import { D1Database } from './d1-helper.mjs';
import { ensureDailySchema } from '../functions/daily-schema.js';
import { archiveDetailPage } from '../functions/coast-archive-v2-details.js';
import { MODULES,encodeRecordObject } from '../functions/coast-archive-v2-manifest.js';
import { digestBytes } from '../functions/coast-archive-v2-chunks.js';
import { createArchiveSession,registerArchiveObject,putArchiveChunk } from '../functions/coast-archive-v2-stage.js';
import { restoreArchiveRecord } from '../functions/coast-archive-v2-restore-record.js';
test('daily groups restore original comments, individual likes, diary and profile without changing timestamps',async()=>{
 const src=new D1Database(),dst=new D1Database();await ensureDailySchema(src);
 await src.prepare("INSERT INTO daily_moments (id,date,author,source,status,text,published_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").bind('m','2026-11-24','owner','manual','published','正文',1,1,2).run();
 await src.prepare("INSERT INTO daily_moment_comments (id,moment_id,author,text,created_at,model_id,usage_json) VALUES (?,?,?,?,?,?,?)").bind('c','m','model_partner','评论',3,'fixture','{"total_tokens":23}').run();
 await src.prepare("INSERT INTO daily_moment_likes (moment_id,actor,created_at) VALUES (?,?,?)").bind('m','owner',4).run();
 await src.prepare("INSERT INTO daily_diaries (id,date,author,source,text,tags_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").bind('d','2026-11-24','model_partner','manual','日记','["海岸"]',5,6).run();
 await src.prepare("INSERT INTO daily_profile (id,updated_at) VALUES (?,?)").bind('owner',7).run();
 const records=[],objects=[],kinds=['daily_moments','daily_diaries','daily_comments','daily_likes','daily_profile'];
 const identity=async(kind,key)=>kind+':'+await digestBytes(new TextEncoder().encode(JSON.stringify(key)));
 for(const kind of kinds)for(const data of (await archiveDetailPage(src,kind)).items){
   const o=await encodeRecordObject({kind,data});objects.push(o);
   const id=await identity(kind,kind==='daily_likes'?[data.moment_id,data.actor]:[data.id]);
   const deps=['daily_comments','daily_likes'].includes(kind)?['daily/'+await identity('daily_moments',[data.moment_id])]:[];
   records.push({module:'daily',id,record_object:o.descriptor.object_sha256,media_objects:[],dependencies:deps});
 }
 const m={format:'elementera-coast-archive',version:2,workspace:'backend',application_id:'com.elementeracoast.source',exported_at:'2026-01-01T00:00:00Z',modules:MODULES.map(module=>({module,coverage:module==='daily'?'partial':'unavailable',count:module==='daily'?records.length:0})),records,objects:objects.map(o=>o.descriptor)};
 const s=await createArchiveSession(dst);
 for(const o of objects){await registerArchiveObject(dst,s.id,o.descriptor);for(let i=0;i<o.chunks.length;i++)await putArchiveChunk(dst,s.id,o.descriptor.object_sha256,i,o.chunks[i]);}
 for(const kind of ['daily_moments','daily_diaries','daily_profile']){
   const r=records.find(r=>r.id.startsWith(kind+':'));
   const p=await restoreArchiveRecord(dst,s.id,m,'daily',r.id,false);assert.equal(p.ready,kind==='daily_moments'?3:1);
   assert.equal((await archiveDetailPage(dst,kind)).items.length,0);
   await restoreArchiveRecord(dst,s.id,m,'daily',r.id,true);
   assert.equal((await restoreArchiveRecord(dst,s.id,m,'daily',r.id,false)).existing,p.ready);
 }
 for(const kind of kinds)assert.deepEqual((await archiveDetailPage(dst,kind)).items,(await archiveDetailPage(src,kind)).items);
 await dst.prepare("UPDATE daily_moment_comments SET text='edited' WHERE id='c'").run();
 const r=records.find(r=>r.id.startsWith('daily_moments:'));await assert.rejects(()=>restoreArchiveRecord(dst,s.id,m,'daily',r.id,true),/never overwrite/);
});

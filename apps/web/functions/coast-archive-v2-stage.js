import { validateArchiveManifest } from './coast-archive-v2-manifest.js';
import { ARCHIVE_CHUNK_BYTES, digestBytes, validateObjectDescriptor, stageVerifiedObject } from './coast-archive-v2-chunks.js';
const GIB=1024**3;
export const STAGING_LIMITS=Object.freeze({sessionBytes:3*GIB,totalBytes:4*GIB,sessions:3,objects:8192,ttlMs:86400000,chunkBytes:ARCHIVE_CHUNK_BYTES});
const idPattern=/^[a-f0-9-]{36}$/;
const hashPattern=/^[a-f0-9]{64}$/;
const check=(ok,message,status=400)=>{if(!ok){const e=Error(message);e.status=status;throw e;}};
const ready=new WeakMap();
export async function ensureArchiveStage(db){
  let p=ready.get(db);
  if(!p){p=(async()=>{
    await db.prepare('CREATE TABLE IF NOT EXISTS coast_archive_sessions (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)').run();
    await db.prepare('CREATE TABLE IF NOT EXISTS coast_archive_objects (session_id TEXT NOT NULL, object_hash TEXT NOT NULL, size INTEGER NOT NULL, descriptor TEXT NOT NULL, PRIMARY KEY(session_id,object_hash), FOREIGN KEY(session_id) REFERENCES coast_archive_sessions(id) ON DELETE CASCADE)').run();
    await db.prepare('CREATE TABLE IF NOT EXISTS coast_archive_chunks (session_id TEXT NOT NULL, object_hash TEXT NOT NULL, chunk_index INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY(session_id,object_hash,chunk_index), FOREIGN KEY(session_id,object_hash) REFERENCES coast_archive_objects(session_id,object_hash) ON DELETE CASCADE)').run();
  })();ready.set(db,p);}
  try{await p;}catch(e){ready.delete(db);throw e;}
}
async function session(db,id,{expired=false}={}){
  check(typeof id==='string'&&idPattern.test(id),'invalid session id');
  await ensureArchiveStage(db);
  const row=await db.prepare('SELECT * FROM coast_archive_sessions WHERE id=?').bind(id).first();
  check(row,'archive session not found',404);
  check(expired||row.expires_at>Date.now(),'archive session expired; cancel to release space',410);
  return row;
}
// Reap only expired staging sessions, never live archive or chat tables.
export async function reapExpiredArchiveSessions(db,now=Date.now()){
  await ensureArchiveStage(db);
  await db.batch([
    db.prepare('DELETE FROM coast_archive_chunks WHERE session_id IN (SELECT id FROM coast_archive_sessions WHERE expires_at<=?)').bind(now),
    db.prepare('DELETE FROM coast_archive_objects WHERE session_id IN (SELECT id FROM coast_archive_sessions WHERE expires_at<=?)').bind(now),
    db.prepare('DELETE FROM coast_archive_sessions WHERE expires_at<=?').bind(now)
  ]);
}
export async function createArchiveSession(db){
  await reapExpiredArchiveSessions(db);
  const id=crypto.randomUUID(),now=Date.now();
  const r=await db.prepare('INSERT INTO coast_archive_sessions (id,created_at,expires_at) SELECT ?,?,? WHERE (SELECT COUNT(*) FROM coast_archive_sessions)<?').bind(id,now,now+STAGING_LIMITS.ttlMs,STAGING_LIMITS.sessions).run();
  check(r.meta.changes===1,'archive staging session quota reached; cancel unused sessions',409);
  return {id,created_at:now,expires_at:now+STAGING_LIMITS.ttlMs,limits:STAGING_LIMITS};
}
export async function listArchiveSessions(db){
  await ensureArchiveStage(db);
  return (await db.prepare('SELECT s.id,s.created_at,s.expires_at,COALESCE(SUM(o.size),0) AS reserved_bytes,COUNT(o.object_hash) AS objects FROM coast_archive_sessions s LEFT JOIN coast_archive_objects o ON o.session_id=s.id GROUP BY s.id ORDER BY s.created_at').all()).results;
}
export async function cancelArchiveSession(db,id){
  // Already reaped/cancelled sessions are safe to close again.
  check(typeof id==='string'&&idPattern.test(id),'invalid session id');
  await ensureArchiveStage(db);
  // Explicit deletion also works in SQLite test environments with foreign keys disabled.
  await db.batch([
    db.prepare('DELETE FROM coast_archive_chunks WHERE session_id=?').bind(id),
    db.prepare('DELETE FROM coast_archive_objects WHERE session_id=?').bind(id),
    db.prepare('DELETE FROM coast_archive_sessions WHERE id=?').bind(id)
  ]);
  return {cancelled:true};
}
export async function registerArchiveObject(db,id,descriptor){
  await session(db,id);
  const d=await validateObjectDescriptor(descriptor,{maxBytes:STAGING_LIMITS.sessionBytes,maxChunks:3072});
  const serialized=JSON.stringify({size:d.size,chunks:d.chunks,object_sha256:d.object_sha256});
  const existing=await db.prepare('SELECT descriptor FROM coast_archive_objects WHERE session_id=? AND object_hash=?').bind(id,d.object_sha256).first();
  if(existing){check(existing.descriptor===serialized,'object descriptor conflict',409);return {registered:true,existing:true};}
  // Single conditional statement reserves quota even if two requests arrive together.
  const r=await db.prepare('INSERT OR IGNORE INTO coast_archive_objects (session_id,object_hash,size,descriptor) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM coast_archive_sessions WHERE id=? AND expires_at>?) AND (SELECT COUNT(*) FROM coast_archive_objects WHERE session_id=?)<? AND (SELECT COALESCE(SUM(size),0) FROM coast_archive_objects WHERE session_id=?)+?<=? AND (SELECT COALESCE(SUM(size),0) FROM coast_archive_objects)+?<=?').bind(id,d.object_sha256,d.size,serialized,id,Date.now(),id,STAGING_LIMITS.objects,id,d.size,STAGING_LIMITS.sessionBytes,d.size,STAGING_LIMITS.totalBytes).run();
  if(r.meta.changes!==1){const prior=await db.prepare('SELECT descriptor FROM coast_archive_objects WHERE session_id=? AND object_hash=?').bind(id,d.object_sha256).first();check(prior?.descriptor===serialized,'archive staging quota reached or session expired',409);}
  return {registered:true,existing:r.meta.changes!==1};
}
async function object(db,id,hash){
  await session(db,id);check(typeof hash==='string'&&hashPattern.test(hash),'invalid object id');
  const row=await db.prepare('SELECT descriptor FROM coast_archive_objects WHERE session_id=? AND object_hash=?').bind(id,hash).first();
  check(row,'archive object not registered',404);return JSON.parse(row.descriptor);
}
const asBytes=x=>x instanceof ArrayBuffer?new Uint8Array(x):ArrayBuffer.isView(x)?new Uint8Array(x.buffer,x.byteOffset,x.byteLength):Uint8Array.from(x||[]);
export async function putArchiveChunk(db,id,hash,index,bytes){
  const d=await object(db,id,hash);
  check(Number.isInteger(index)&&index>=0&&index<d.chunks.length,'invalid chunk index');
  check(bytes instanceof Uint8Array&&bytes.length===Math.min(ARCHIVE_CHUNK_BYTES,d.size-index*ARCHIVE_CHUNK_BYTES)&&await digestBytes(bytes)===d.chunks[index],'archive chunk integrity mismatch');
  const r=await db.prepare('INSERT OR IGNORE INTO coast_archive_chunks (session_id,object_hash,chunk_index,data) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM coast_archive_objects o JOIN coast_archive_sessions s ON s.id=o.session_id WHERE o.session_id=? AND o.object_hash=? AND s.expires_at>?)').bind(id,hash,index,bytes,id,hash,Date.now()).run();
  if(r.meta.changes!==1){const prior=await db.prepare('SELECT data FROM coast_archive_chunks WHERE session_id=? AND object_hash=? AND chunk_index=?').bind(id,hash,index).first();check(prior&&await digestBytes(asBytes(prior.data))===d.chunks[index],'staged chunk conflict or session expired',409);}
  return {stored:true,index,existing:r.meta.changes!==1};
}
export async function archiveObjectStatus(db,id,hash){
  const descriptor=await object(db,id,hash);
  const rows=(await db.prepare('SELECT chunk_index FROM coast_archive_chunks WHERE session_id=? AND object_hash=? ORDER BY chunk_index').bind(id,hash).all()).results;
  const received=rows.map(r=>r.chunk_index);
  return {descriptor,received,complete:received.length===descriptor.chunks.length};
}
export async function* readStagedArchiveChunks(db,id,hash){
  const d=await object(db,id,hash);
  for(let i=0;i<d.chunks.length;i++){
    const row=await db.prepare('SELECT data FROM coast_archive_chunks WHERE session_id=? AND object_hash=? AND chunk_index=?').bind(id,hash,i).first();
    check(row,'staged archive incomplete',409);yield asBytes(row.data);
  }
}
export async function verifyStagedArchiveObject(db,id,hash){
  const d=await object(db,id,hash);
  return stageVerifiedObject(d,readStagedArchiveChunks(db,id,hash),async()=>{},{maxBytes:STAGING_LIMITS.sessionBytes,maxChunks:3072});
}

// Read-only preflight: every registered object must match the manifest and every
// chunk index must exist. This is not a substitute for byte re-verification at restore.
export async function preflightArchiveSession(db,id,manifest){
  await session(db,id);
  const summary=await validateArchiveManifest(manifest,{maxBytes:STAGING_LIMITS.sessionBytes,maxObjects:STAGING_LIMITS.objects});
  const expected=new Map(manifest.objects.map(o=>[o.object_sha256,o]));
  const rows=(await db.prepare('SELECT object_hash,size,descriptor FROM coast_archive_objects WHERE session_id=? ORDER BY object_hash').bind(id).all()).results||[];
  const unexpected=rows.filter(r=>!expected.has(r.object_hash)).map(r=>r.object_hash);
  const known=new Set(),incomplete=[];
  for(const row of rows){
    const d=expected.get(row.object_hash);if(!d)continue;
    known.add(row.object_hash);
    const actual=JSON.parse(row.descriptor);
    check(actual.size===d.size&&actual.object_sha256===d.object_sha256&&JSON.stringify(actual.chunks)===JSON.stringify(d.chunks),'staged descriptor mismatch',409);
  }
  // Aggregate received chunk counts without pulling original bytes into memory.
  const counts=(await db.prepare('SELECT object_hash,COUNT(*) AS n,COALESCE(SUM(length(data)),0) AS bytes,MIN(chunk_index) AS first_index,MAX(chunk_index) AS last_index FROM coast_archive_chunks WHERE session_id=? GROUP BY object_hash').bind(id).all()).results||[];
  const byHash=new Map(counts.map(r=>[r.object_hash,r]));
  for(const d of manifest.objects){
    const n=byHash.get(d.object_sha256);
    if(!known.has(d.object_sha256)||(d.chunks.length===0?Boolean(n):!n||n.n!==d.chunks.length||n.bytes!==d.size||n.first_index!==0||n.last_index!==d.chunks.length-1))incomplete.push(d.object_sha256);
  }
  return {...summary,ready_for_byte_verification:incomplete.length===0&&unexpected.length===0,incomplete,unexpected,restore_supported:false,byte_verification_pending:true};
}

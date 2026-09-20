const schemaPromises=new WeakMap();
const CHANNELS=new Set(['external','api_common_room','official_mcp']);
function clip(value,max){return String(value??'').trim().slice(0,max);}
async function run(db,sql,params=[]){return db.prepare(sql).bind(...params).run();}
async function all(db,sql,params=[]){const result=await db.prepare(sql).bind(...params).all();return result?.results||[];}
export async function ensureExternalEntrySchema(db){
  if(!db?.prepare)throw Object.assign(new Error('chat_db_not_configured'),{type:'chat_db_not_configured',status:503});
  let ready=schemaPromises.get(db);
  if(!ready){
    ready=run(db,`CREATE TABLE IF NOT EXISTS source_external_messages (
      id TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      conversation_id TEXT NOT NULL DEFAULT '',
      author TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`);
    schemaPromises.set(db,ready);
  }
  try{await ready;}catch(error){schemaPromises.delete(db);throw error;}
}
function publicRow(row){return {id:row.id,channel:row.channel,conversation_id:row.conversation_id||'',author:row.author||'',content:row.content,created_at:new Date(Number(row.created_at)).toISOString()};}
export async function listExternalMessages(db,{channel='',limit=100}={}){
  await ensureExternalEntrySchema(db);
  const safeLimit=Math.min(200,Math.max(1,Number(limit)||100));
  const cleanChannel=CHANNELS.has(channel)?channel:'';
  const rows=cleanChannel
    ? await all(db,'SELECT * FROM source_external_messages WHERE channel = ? ORDER BY created_at DESC LIMIT ?',[cleanChannel,safeLimit])
    : await all(db,'SELECT * FROM source_external_messages ORDER BY created_at DESC LIMIT ?',[safeLimit]);
  return rows.map(publicRow);
}
export async function appendExternalMessage(db,value={}){
  await ensureExternalEntrySchema(db);
  const channel=CHANNELS.has(String(value.channel||''))?String(value.channel):'external';
  const content=clip(value.content,12000);
  if(!content)throw Object.assign(new Error('external_content_required'),{type:'external_content_required',status:400});
  const id=clip(value.id,180)||`external-${crypto.randomUUID()}`;
  const createdAt=Number(value.created_at)||Date.now();
  await run(db,'INSERT INTO source_external_messages (id, channel, conversation_id, author, content, created_at) VALUES (?, ?, ?, ?, ?, ?)',[
    id,channel,clip(value.conversation_id,180),clip(value.author,120),content,createdAt,
  ]);
  return {id,channel,conversation_id:clip(value.conversation_id,180),author:clip(value.author,120),content,created_at:new Date(createdAt).toISOString()};
}
